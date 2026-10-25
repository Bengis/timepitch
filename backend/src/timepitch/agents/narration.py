"""Approved factual sentence families; numbers and names are rendered separately."""
SENTENCES = {
    'en': {
        'fan': {
            'overview': ('The recorded action tells the story so far.', 'Here is a moment from this simulated matchup.'),
            'goal': ('A recorded finish changes the scoreboard.', 'A goal lights up this simulated matchup.'),
            'shot': ('A chance arrives: follow the recorded shot.', 'The attack creates a shot in this simulation.'),
            'pressure': ('The defending side applies pressure.', 'Pressure is part of this recorded passage of play.'),
            'possession_edge': ('One side has enjoyed more of the ball.', 'The possession balance favours one side so far.'),
        },
        'analyst': {
            'overview': ('This window summarises completed engine events.', 'The evidence covers resolved actions up to this window.'),
            'goal': ('The cited goal follows a resolved shot; the engine supplies the score.', 'The goal claim is supported by the cited scoring event.'),
            'shot': ('The cited action records a shot; it does not establish chance quality by itself.', 'A shot is present in the evidence; its outcome is recorded separately.'),
            'pressure': ('The cited pressure is an engine action, not a measured historical pressing statistic.', 'The evidence supports a pressure action, not a claim of tactical superiority.'),
            'possession_edge': ('Cumulative possession time exceeds the threshold for a possession advantage.', 'The recorded possession balance meets the simulation threshold for an advantage.'),
        },
    },
    'es': {
        'fan': {
            'overview': ('La acción registrada cuenta lo ocurrido hasta aquí.', 'Este es un momento del enfrentamiento simulado.'),
            'goal': ('Una definición registrada cambia el marcador.', 'Un gol anima este enfrentamiento simulado.'),
            'shot': ('Llega una ocasión: sigue el tiro registrado.', 'El ataque genera un tiro en esta simulación.'),
            'pressure': ('El equipo defensor ejerce presión.', 'La presión forma parte de este tramo del partido.'),
            'possession_edge': ('Un equipo ha disfrutado más del balón.', 'El balance de posesión favorece a un equipo hasta aquí.'),
        },
        'analyst': {
            'overview': ('Esta ventana resume eventos ya resueltos por el motor.', 'La evidencia abarca acciones resueltas hasta esta ventana.'),
            'goal': ('El gol citado procede de un tiro resuelto; el motor aporta el marcador.', 'La afirmación de gol se apoya en el evento anotador citado.'),
            'shot': ('La acción citada registra un tiro; por sí sola no demuestra la calidad de la ocasión.', 'La evidencia contiene un tiro; su desenlace se registra por separado.'),
            'pressure': ('La presión citada es una acción del motor, no una estadística histórica medida.', 'La evidencia respalda una presión, no una afirmación de superioridad táctica.'),
            'possession_edge': ('El tiempo acumulado de posesión supera el umbral de ventaja de posesión.', 'El balance de posesión registrado cumple el umbral de ventaja de la simulación.'),
        },
    },
}

for locale,modes in {
    'en':{
        'fan':{
            'chance_quality_edge':('The chances favour one side on simulated xG.','One side leads the simulated chance total.'),
            'territory_edge':('One side is completing more passes deep in attack.','The attacking-third pass balance favours one side.'),
            'distance_leader':('One player leads the simulated distance covered.','The recorded motion has a unique distance leader.'),
        },
        'analyst':{
            'chance_quality_edge':('Cumulative generative shot probability is higher; this does not establish a goal.','The simulated xG edge is supported by resolved shots, not historical tracking.'),
            'territory_edge':('Field tilt TP exceeds 50% with a positive eligible-pass denominator.','Completed attacking-third passes support this TP territorial edge.'),
            'distance_leader':('Canonical samples support a unique simulated distance leader; resets are excluded.','Distance is derived from observed simulation intervals, not browser frames or historical sensors.'),
        },
    },
    'es':{
        'fan':{
            'chance_quality_edge':('Las ocasiones favorecen a un equipo según el xG simulado.','Un equipo lidera el total simulado de ocasiones.'),
            'territory_edge':('Un equipo completa más pases cerca de la portería rival.','El balance de pases en el último tercio favorece a un equipo.'),
            'distance_leader':('Un jugador lidera la distancia simulada recorrida.','El movimiento registrado tiene un líder único de distancia.'),
        },
        'analyst':{
            'chance_quality_edge':('La probabilidad generativa acumulada de los tiros es mayor; esto no demuestra un gol.','La ventaja de xG simulado se apoya en tiros resueltos, no en tracking histórico.'),
            'territory_edge':('El dominio territorial TP supera el 50% con denominador de pases elegibles positivo.','Los pases completados en el último tercio respaldan esta ventaja territorial TP.'),
            'distance_leader':('Las muestras canónicas respaldan un líder único de distancia simulada; se excluyen reinicios.','La distancia procede de intervalos observados del simulador, no de frames del navegador o sensores históricos.'),
        },
    },
}.items():
    for mode,phrases in modes.items():SENTENCES[locale][mode].update(phrases)


def render_narration(explanation,statistics=None):
    sentence=SENTENCES[explanation.locale][explanation.mode][explanation.category][explanation.variant]
    if explanation.metric_id is None:return sentence
    facts=[f for f in (statistics.facts if statistics else []) if f.category==explanation.category
           and f.metric_id==explanation.metric_id and f.side==explanation.side and f.player_key==explanation.metric_player_key]
    if len(facts)!=1:raise ValueError('Narration has no authorized metric fact')
    fact=facts[0]
    def number(value):
        text=f'{value:,.2f}'
        return text.translate(str.maketrans(',.','.,')) if explanation.locale=='es' else text
    comparison=' vs '+number(fact.comparison_value) if fact.comparison_value is not None else ''
    return f'{sentence} {fact.player_name or fact.team_name}: {number(fact.value)}{comparison} {fact.unit}.'


def fallback_text(locale):
    return 'Recorded facts only; local AI explanation is not available.' if locale == 'en' else 'Solo hechos registrados; la explicación de IA local no está disponible.'
