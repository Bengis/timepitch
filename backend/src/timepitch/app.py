from pathlib import Path
from contextlib import asynccontextmanager, ExitStack
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .api.catalog import catalog_router
from .api.matches import matches_router
from .matches.repository import MatchRepository
from .matches.service import MatchService
from .catalog.repository import CatalogRepository
from .security import install_security, load_session_key
from .api.explanations import explanations_router
from .agents.service import ExplanationService
from .agents.analysis import LocalAgentRunner
from .runtime import RuntimeLease
from .api.statistics import statistics_router
from .statistics.service import StatisticsService
from .api.grf import grf_router
from .grf.process import GrfProcess
from .grf.repository import GrfRepository
from .grf.service import GrfService
from .grf.physical_process import PhysicalProcess
from .grf.action_process import ActionProcess
from .grf.physical_repository import PhysicalRepository
from .api.touchlines import touchlines_router
from .touchlines.service import TouchLinesRepository, TouchLinesService, default_node
from .chronicles.auth import ChronicleSettings
from .chronicles.repository import ChronicleRepository
from .chronicles.service import ChronicleService, saved_source
from .api.chronicles import chronicles_router
from .api.azure_chronicles import azure_chronicles_router
from .chronicles.azure.settings import AzureSettings
from .chronicles.azure.repository import AzureRepository, AzureConflict
from .chronicles.azure.service import AzureChronicleService
from .api.historical import historical_router
from .historical.repository import HistoricalRepository
from .reconstruction.repository import ReconstructionRepository
from .historical.crosswalk import load_crosswalk
from .replays_static import ReplayFiles
from .web_static import WebDistFiles
import os
import sqlite3


def create_app(dataset_path: Path | None = None, runtime_dir: Path | None = None) -> FastAPI:
    catalog = CatalogRepository(dataset_path or config.DATASET,advanced_path=config.ADVANCED_DATASET)
    runtime = runtime_dir or Path(os.getenv('TIMEPITCH_RUNTIME_DIR', config.ROOT / '.local'))
    chronicles_settings=ChronicleSettings.from_env()
    azure_config_error=False
    try:azure_settings=AzureSettings.from_env()
    except (ValueError,OSError):
        azure_settings=AzureSettings();azure_config_error=True
    @asynccontextmanager
    async def lifespan(app):
        mode=os.getenv('TIMEPITCH_GRF_MODE','compressed')
        telemetry=os.getenv('TIMEPITCH_GRF_PHYSICAL_TELEMETRY','legacy')
        GrfService.validate_selection(mode,telemetry)
        model = os.getenv('TIMEPITCH_LOCAL_MODEL', '')
        with ExitStack() as leases:
            leases.enter_context(RuntimeLease(runtime / 'runtime.lock'))
            if model: leases.enter_context(RuntimeLease(config.ROOT / '.local/inference.lock'))
            app.state.session_key = load_session_key(runtime / 'session.key')
            service = MatchService(catalog, MatchRepository(runtime / 'runtime.sqlite'))
            app.state.matches = service
            app.state.statistics = StatisticsService(service.repository)
            grf = GrfService(catalog, GrfRepository(runtime / 'grf.sqlite'), GrfProcess(config.GRF_PYTHON, config.GRF_NATIVE_DIR),
                physical_repository=PhysicalRepository(runtime/'grf-physical.sqlite'),
                physical_runner=(ActionProcess(config.GRF_PYTHON,config.GRF_ACTION_NATIVE_DIR) if telemetry=='actions-1'
                    else PhysicalProcess(config.GRF_PYTHON,config.GRF_PHYSICAL_NATIVE_DIR)),
                mode=mode,physical_telemetry=telemetry)
            app.state.grf = grf
            touchlines = TouchLinesService(catalog, TouchLinesRepository(runtime / 'touchlines.sqlite'), config.TOUCHLINES_DIR, default_node())
            app.state.touchlines = touchlines
            # TP253: crónica IA en vivo al final de los partidos simulados (crew en Azure); apagada sin su modo y ficheros.
            from .chronicles.live_facts import live_source
            from .crew.live import LiveCrew, LiveCrewSettings
            app.state.live_crew = LiveCrew(live_source(grf, touchlines), LiveCrewSettings.from_env(), runtime / 'live-crew')
            def runner_factory():
                if model != 'qwen2.5-1.5b': raise RuntimeError('Explicit local model activation required')
                runner = LocalAgentRunner(model)
                if runner.model_id != 'qwen2.5-1.5b-instruct-generic-gpu:4@4': raise RuntimeError('Model revision requires acceptance before use')
                return runner
            explanations = ExplanationService(service.repository, runner_factory, 'qwen2.5-1.5b-instruct-generic-gpu:4@4')
            app.state.explanations = explanations
            app.state.chronicles=ChronicleService(ChronicleRepository(runtime/'runtime.sqlite'),saved_source(service.repository,grf))
            app.state.azure_chronicles=None
            try:
                app.state.azure_chronicles=AzureChronicleService(AzureRepository(runtime/'runtime.sqlite'),
                    saved_source(service.repository,grf),azure_settings)
            except (AzureConflict,OSError,sqlite3.DatabaseError):
                app.state.azure_chronicles_config_error=True
            try:
                yield
            finally:
                grf.close()
                touchlines.close()
                await explanations.close()
                service.close()
    app = FastAPI(title='TimePitch', version='0.1.0', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(catalog_router(catalog))
    historical = None
    historical_state = 'absent'
    historical_enabled = os.getenv('TIMEPITCH_RECONSTRUCTION_ENABLED', '0') == '1'
    historical_path = os.getenv('TIMEPITCH_HISTORICAL_DATASET', config.HISTORICAL_DATASET)
    # Public serving requires separate, explicit operator confirmation of permission.
    publication_approved = os.getenv('TIMEPITCH_HISTORICAL_PUBLICATION_APPROVED', '') == '1'
    if os.getenv('TIMEPITCH_PUBLIC_ORIGIN', '').strip() and not publication_approved:
        historical_enabled = False
    if historical_enabled and historical_path:
        try:
            historical = HistoricalRepository(Path(historical_path))
            historical_state = 'ready'
        except (ValueError, OSError, sqlite3.DatabaseError):
            historical_state = 'invalid'
    reconstruction=None
    reconstruction_path=os.getenv('TIMEPITCH_RECONSTRUCTION_DATASET',config.RECONSTRUCTION_DATASET)
    if historical is not None and reconstruction_path:
        try:
            reconstruction=ReconstructionRepository(Path(reconstruction_path))
            if reconstruction.dataset_version!=historical.dataset_version:
                reconstruction=None
        except (ValueError,OSError):
            reconstruction=None
    try:crosswalk=load_crosswalk(config.ROOT/'docs/data/statsbomb-club-crosswalk.json')
    except (ValueError,OSError,KeyError):crosswalk=None
    app.include_router(historical_router(historical, dataset_state=historical_state,
        two_modes_ui=os.getenv('TIMEPITCH_TWO_MODES_UI', '0') == '1', enabled=historical_enabled,reconstruction=reconstruction,catalog=catalog,crosswalk=crosswalk,
        publication_approved=publication_approved))
    app.include_router(matches_router())
    app.include_router(explanations_router())
    app.include_router(statistics_router())
    app.include_router(grf_router())
    app.include_router(touchlines_router())
    from .api.live_crew import live_crew_router
    app.include_router(live_crew_router())
    app.state.chronicles_settings=chronicles_settings
    app.state.azure_chronicles_settings=azure_settings
    app.state.azure_chronicles_config_error=azure_config_error
    # v2 must precede the legacy /chronicles/{job_id} catch-all.
    app.include_router(azure_chronicles_router())
    app.include_router(chronicles_router())
    install_security(app,runtime_dir=runtime,worker_auth=chronicles_settings)

    @app.get('/', include_in_schema=False)
    def index():
        index_path = config.WEB_DIST / 'index.html'
        if not index_path.is_file():
            raise HTTPException(503, 'Build the local web application first: npm --prefix web run build')
        return FileResponse(index_path)

    @app.get('/art/timepitch-premier.png', include_in_schema=False)
    def cover():
        return FileResponse(config.ART)

    app.mount('/assets', StaticFiles(directory=config.WEB_DIST / 'assets', check_dir=False), name='assets')
    # Copied by Vite from web/public; without these mounts the built app 404s them (TP207).
    if (config.WEB_DIST / 'data').is_dir():
        app.mount('/data', WebDistFiles(directory=config.WEB_DIST / 'data', suffix='.json',
                                        media_type='application/json'), name='data')
    if (config.WEB_DIST / 'licenses').is_dir():
        app.mount('/licenses', WebDistFiles(directory=config.WEB_DIST / 'licenses', suffix='.txt',
                                            media_type='text/plain; charset=utf-8'), name='licenses')
    if config.REPLAYS_DIR.is_dir():
        app.mount('/replays', ReplayFiles(directory=config.REPLAYS_DIR), name='replays')
    return app
