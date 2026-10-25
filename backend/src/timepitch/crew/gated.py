"""One gated, ledgered model call, shared by the crew roles and the Foundry judge.

Replays a receipt at no cost; an intent without a receipt is an uncertain send that stays charged
and is never resent; otherwise arms the httpx gate (which commits the intent), sends once and
writes the receipt. A model string outside the binding fails the step.
"""
from typing import Any, Awaitable, Callable

from ..chronicles.azure.budget import maximum_liability
from .agents import AgentResult, SendGate, _identifier
from .ledger import CrewLedger
from .models import MAX_OUTPUT_TOKENS, CrewBinding, CrewStep


async def gated_call(*, ledger: CrewLedger, gate: SendGate, binding: CrewBinding, tariff, tracer, request_hash: str,
                     step: str, send: Callable[[], Awaitable[AgentResult]] | None,
                     parse: Callable[[str], Any]) -> tuple[Any, CrewStep]:
    rh = request_hash
    receipt = ledger.receipt(rh, step)
    if receipt is not None:
        value = None
        code = receipt.error or 'replayed'
        if receipt.error is None:
            try:
                value = parse(receipt.output)
            except (ValueError, TypeError):
                code = 'invalid_result'
        return value, CrewStep(role=step, code=code, model=receipt.model, request_id=receipt.request_id,
                               input_tokens=receipt.input_tokens, output_tokens=receipt.output_tokens,
                               reserved=receipt.reserved, cost=receipt.cost, replayed=True)
    intent = ledger.intent(rh, step)
    if intent is not None:
        return None, CrewStep(role=step, code='uncertain_send', reserved=intent.reserved, cost=intent.reserved, replayed=True)
    if send is None:
        return None, CrewStep(role=step, code='envelope_refused', reason='no_client')
    slot, token = gate.arm(rh, step)
    try:
        with tracer.span('crew.call', **{'crew.role': step, 'crew.request_hash': rh}):
            result = await send()
    except Exception:
        if slot.intent is None:
            # Refused by the gate or failed before any request: nothing sent, nothing charged.
            return None, CrewStep(role=step, code='envelope_refused', reason=slot.refused or 'not_sent')
        if slot.status is None:
            # Sent with no response: uncertain. The intent stays charged and is never resent.
            return None, CrewStep(role=step, code='uncertain_send', reserved=slot.intent.reserved, cost=slot.intent.reserved)
        receipt = ledger.record_receipt(rh, step, model=None, request_id=slot.request_id, input_tokens=None,
                                        output_tokens=None, cost=slot.intent.reserved, output=None, error='provider_error')
        return None, CrewStep(role=step, code='provider_error', request_id=slot.request_id,
                              reserved=receipt.reserved, cost=receipt.cost)
    finally:
        gate.disarm(token)
    reserved = slot.intent.reserved
    error = None
    if _identifier(result.model) not in binding.accepted_models:
        error = 'model_mismatch'
    if result.input_tokens is None or result.output_tokens is None:
        cost = reserved
        error = error or 'invalid_result'
    else:
        cost = maximum_liability(tariff, result.input_tokens, result.output_tokens)
        if result.input_tokens > slot.intent.input_upper or result.output_tokens > MAX_OUTPUT_TOKENS:
            cost = max(cost, reserved)
            error = error or 'usage_bound_exceeded'
    value = None
    if error is None:
        try:
            value = parse(result.text)
        except (ValueError, TypeError):
            error = 'invalid_result'
    model = _identifier(result.model)
    ledger.record_receipt(rh, step, model=model, request_id=slot.request_id, input_tokens=result.input_tokens,
                          output_tokens=result.output_tokens, cost=cost, output=result.text, error=error)
    return value, CrewStep(role=step, code=error or 'ok', model=model, request_id=slot.request_id,
                           input_tokens=result.input_tokens, output_tokens=result.output_tokens,
                           reserved=reserved, cost=cost)
