# Estilo «Clásico 16 bits» · arte (TP219)

Arte original de TimePitch para un renderizado cenital aparte, inspirado en el aspecto general de los juegos de fútbol de
ordenador de principios de los 90 (jugadores diminutos vistos desde arriba, contorno oscuro, campo vertical con franjas).
**No contiene sprites, logotipos, tipografías ni nombres de ningún juego comercial**: todo sale de
`web/scripts/sensible-art/` (un muñeco 3D diminuto rasterizado a píxel con reglas de pixel art, poses escritas a mano,
balón, escenario y letra dibujados píxel a píxel). En la interfaz se llama «Clásico 16 bits» / «Retro 16-bit».

Regenerar (desde `web/`, determinista): `node scripts/sensible-art/generate.ts` · con hojas de contacto en
`.local/sensible/`: `node scripts/sensible-art/generate.ts --sheets`.

## Ficheros

| Fichero | Qué es |
|---|---|
| `atlas.png` | PNG **indexado** 1024×256 (2480 sprites, de ellos ~1800 capas de pelo diminutas). El índice de paleta es el dato; los colores guardados son una vista previa (rojo/blanco) con un color distinto por índice. |
| `atlas.json` | Rectángulo y ancla de cada sprite (una entrada por línea), animaciones (fotogramas, fps, bucle), zonas de cabeza, zona de dorsal por fotograma (`numbers`), índices usados con su color de vista previa. |
| `palette.ts` | Roles de índice, rampas luz/medio/sombra y `buildPaletteLUT(kit, look)` → tabla RGBA de 256 entradas. |
| `pitch.png` / `pitch.json` | Estadio completo 726×1062 RGBA a 8 px/m (campo 544×840, vallas, muro, grada) y sus coordenadas. |
| `tiles.png` / `tiles.json` | Las mismas piezas sueltas: césped claro/oscuro, vallas (4 lemas inventados, trasera, laterales), grada en 2 fotogramas, muro. |

## Sprites

Claves `player.<anim>.<dir>.<frame>`, direcciones de pantalla `E SE S SW W NW N NE` (S = hacia la cámara, N = hacia el
fondo; mismo orden que el respaldo retro). Ancla `ax, ay` = punto de apoyo en el suelo.

- Jugador (8 direcciones): `idle` 2, `run` 6, `sprint` 6, `pass` 3, `shot` 4, `slide` 3, `header` 3, `throw` 3,
  `celebrate` 2, `kneeslide` 2, `fall` 3.
- Portero (manga larga y guantes): `gk-ready` 2, `gk-shuffle` 4, `gk-dive-{left,right}-{high,low}` 3, `gk-catch` 2,
  `gk-punt` 3. «left/right» es respecto al portero; la estirada ya incluye el desplazamiento lateral.
- Árbitro (TP222): corre y espera con `run`/`idle` del jugador; propios `ref-whistle` 2 (silbato y brazo señalando) y
  `ref-card` 2 (saca y levanta la tarjeta, color `look.card`). Asistentes: `ar-idle` 2, `ar-run` 6, `ar-flag` 2 con
  banderín. Equipación con `refereeKitFor` (negra, amarilla o violeta, la que más se separa de equipos, porteros y césped).
- Peinados (TP222): los 10 de `AppearanceParams` y la barba salen por paleta (zonas del cráneo, ver abajo). Tupé, rizos,
  melena y moño sobresalen del cráneo y van en capas `hair.<quiff|curly|long|tied>.<anim>.<dir>.<frame>` (mismo ancla
  que el cuerpo; pintar encima). Son la diferencia entre el muñeco con el rasgo y sin él, con el resto del cuerpo como
  oclusor, así que un brazo levantado sigue tapando la melena.
- Dorsales (TP222): `numbers[<anim>.<dir>.<frame>] = [cara, x, y, ancho, alto]` (cara 1 = dorso, 2 = pecho) es la zona
  de camiseta visible. La espalda mide 3–4 px: las cifras propias de 3×5 (`NUMBER_FONT`) se pintan a media rejilla en
  el lienzo final, con `numberStyle(kit)` (color del dorsal si contrasta ≥ 0,3 de luminosidad; si no, blanco o casi
  negro; placa del color dominante en camisetas con rayas, aros, mitades o banda).
- Balón: `ball.{s,m,l}.{0..3}` (4, 5 y 6 px: suelo, media altura, alto) con giro de 4 fotogramas que cierra el ciclo;
  ancla = centro. Sombras `shadow.player`, `shadow.long` (planchas/estiradas), `shadow.ball-{s,m,l}`: índice `shadow`,
  translúcido.
- Escenario: `env.goal-n-net`, `env.goal-n-frame`, `env.goal-s-frame`, `env.goal-s-net` (ancla = centro de la línea de
  gol; orden de pintado en `pitch.json → goals`), `env.flag.{0,1}`, letra de marcador `env.font.<C>` (5×7 engordada,
  avance 8 px; signos como `u003a`).

Los sprites no llevan el balón dentro (saque, blocaje): el balón lo pinta siempre el renderer en su posición.

## Cabezas por paleta (TP222)

Cada píxel del cráneo guarda `112 + zona·3 + tono`. La zona es la firma de ese punto de la esfera: un bit por peinado
(¿es pelo?) y la zona de barba (mentón o mejillas). `HEAD_ZONES` (29 zonas) se calcula igual en el generador y en la
app con un muestreo de Fibonacci determinista; `atlas.json → heads.zones` guarda la lista con que se generó y una prueba
exige que coincidan. Mangas con patrón: `208 + lado·12 + tono·4 + bits` (raya, aro).

## Recolorear

`buildPaletteLUT(kit, { skin, hair, boots, gloves? })` acepta un `KitSpec` tal cual. Roles: camiseta (con bits de zona
raya/aro/mitad/banda: el `pattern.body` elige cuál pinta el `trim`), manga izquierda y derecha, ribete (cuello, puños),
pantalón, medias, botas, guantes, piel (8 tonos `s1…s8`), pelo (6 colores) y, desde TP222, `hairStyle`, `beard` y
`card` en el aspecto y `pattern.sleeves` en la equipación. Para `shaved`/`buzz` se puede pasar como
pelo una mezcla del tono de piel. Leer los índices: decodificar el PNG indexado (IDAT con `DecompressionStream`) o, vía
canvas, buscar cada color en `indexColours` (son únicos). Si el navegador altera `getImageData` (protección
anti-huella), usar la primera vía.

## Vista Táctica en píxel (TP222)

`tactical.ts` dibuja la Táctica como capa propia (no usa el atlas ni `pitch.png`): campo a 2, 4 o 6 px de arte por metro
con paleta fija, fichas de jugador (camiseta, pantalón y dorsal si cabe), árbitros en rombo y balón, ampliado a escala
entera sin suavizar por `retro16.ts`. Es pura y determinista; las pruebas están en `tactical.test.ts`.
