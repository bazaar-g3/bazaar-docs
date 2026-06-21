# Resultados — Pruebas de Carga y Estrés

## Resumen Global

- p95 general: 678.4ms
- Tasa de error global: 1.02%
- Total de requests: 7374

## Desglose por Escenario y Endpoint

| Escenario | Endpoint | avg | p50 | p95 | p99 | max | Error % |
|---|---|---|---|---|---|---|---|
| carga_sostenida | add_to_cart | 48.7ms | 45.5ms | 72.9ms | 79.9ms | 85.6ms | 0.0% |
| carga_sostenida | get_cart | 45.9ms | 48.0ms | 67.4ms | 84.1ms | 86.4ms | 0.0% |
| carga_sostenida | preview | 34.4ms | 32.9ms | 61.6ms | 93.8ms | 95.8ms | 0.0% |
| carga_sostenida | checkout | 669.1ms | 668.3ms | 703.9ms | 764.0ms | 874.7ms | 0.0% |
| estres_moderado | add_to_cart | 49.7ms | 42.9ms | 99.9ms | 123.5ms | 146.9ms | 0.0% |
| estres_moderado | get_cart | 27.2ms | 22.9ms | 58.3ms | 70.2ms | 95.3ms | 0.0% |
| estres_moderado | preview | 19.9ms | 14.9ms | 50.3ms | 64.6ms | 73.8ms | 0.0% |
| estres_moderado | checkout | 616.2ms | 604.7ms | 685.7ms | 730.9ms | 1498.6ms | 0.0% |
| estres_alto | add_to_cart | 89.3ms | 55.0ms | 255.2ms | 412.3ms | 632.2ms | 0.0% |
| estres_alto | get_cart | 59.3ms | 27.8ms | 202.3ms | 372.6ms | 793.3ms | 0.0% |
| estres_alto | preview | 45.8ms | 15.9ms | 199.3ms | 364.0ms | 762.7ms | 0.0% |
| estres_alto | checkout | 646.7ms | 611.8ms | 815.1ms | 1190.8ms | 1673.4ms | 0.0% |

