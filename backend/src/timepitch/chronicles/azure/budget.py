"""Exact conservative liability; no refunds from a successful or failed attempt."""
from decimal import Decimal, ROUND_CEILING, localcontext
from .models import Tariff


def maximum_liability(tariff: Tariff, input_upper_tokens: int, output_tokens: int) -> Decimal:
    if any(type(v) is not int or v<0 or v>100_000_000 for v in (input_upper_tokens,output_tokens)):
        raise ValueError('Invalid token bounds')
    tariff=Tariff.model_validate_json(tariff.model_dump_json())
    with localcontext() as ctx:
        ctx.prec=60
        raw=(tariff.input_per_million*input_upper_tokens+tariff.output_per_million*output_tokens)/Decimal(1_000_000)
        return (raw/tariff.quantum).to_integral_value(rounding=ROUND_CEILING)*tariff.quantum
