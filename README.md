# Arena Rush

Shooter arena multijugador que se juega en el navegador, con **servidor autoritativo**: el servidor decide el movimiento, los disparos y el daño, así que el código del navegador no sirve para hacer trampas.

> "Arena Rush" es un nombre provisional. El juego está *inspirado* en los shooters arcade tipo arena, pero todo (nombre, mapa, arte) es propio.

## Requisitos

- [Node.js](https://nodejs.org/) 20 o superior (LTS)
- [Git](https://git-scm.com/)
- Un navegador moderno (Chrome, Edge o Firefox)

## Cómo jugarlo en tu PC

```bash
git clone https://github.com/yavi-hidalgo/Uberstrike-return.git
cd Uberstrike-return
npm install
npm run dev
```

Esto levanta dos cosas:

| Parte | Dirección | Qué es |
|---|---|---|
| Servidor de juego | `ws://localhost:2567` | Colyseus (Node.js). Decide todo lo que pasa en la partida. |
| Cliente web | <http://localhost:5173> | La página con el juego 3D (Three.js). |

Abre <http://localhost:5173> en **dos pestañas o dos navegadores**, escribe un nombre en cada una y estarán en la misma partida.

Para jugar con alguien de tu misma red Wi-Fi, comparte la dirección "Network" que muestra la consola, por ejemplo `http://192.168.1.20:5173`.

### Controles

| Tecla | Acción |
|---|---|
| `W` `A` `S` `D` | moverse |
| Ratón | apuntar |
| Clic izquierdo | disparar |
| `Espacio` | saltar |
| `R` | recargar |
| `Tab` | ver el marcador |
| `Esc` | soltar el ratón |

**Reglas:** todos contra todos, el primero en llegar a 20 bajas gana la ronda. Un disparo a la cabeza hace el doble de daño.

## Estructura del proyecto

```
shared/src/      Código común (lo usan el servidor y el cliente)
  constants.ts   Velocidad, gravedad, daño, cadencia, límites anti-trampas
  map.ts         El mapa: cajas sólidas y puntos de aparición
  physics.ts     Física de movimiento, colisiones y rayos de disparo
  protocol.ts    Formato de los mensajes cliente <-> servidor
server/src/
  index.ts       Arranque del servidor
  ArenaRoom.ts   La sala de juego: simulación, disparos, anti-trampas
server/test/     Pruebas automáticas con clientes reales
client/src/
  main.ts        Lógica del cliente: conexión, predicción, HUD
  world.ts       Escena 3D: mapa, jugadores, arma, efectos
  audio.ts       Sonidos generados por código
```

## Cómo funciona el anti-trampas

La regla de oro: **el navegador del jugador nunca decide nada importante.** Solo envía qué teclas pulsa y hacia dónde mira, unas 30 veces por segundo.

| Trampa | Cómo se evita |
|---|---|
| **Speed hack** (moverse más rápido) | El servidor procesa como máximo 1 input por tick, con un pequeño margen por el jitter de la red. Mandar 300 inputs por segundo no sirve de nada. |
| **Disparo rápido / munición infinita** | La cadencia, la munición y la recarga las cuenta el servidor. |
| **Vida infinita / daño falso** | El servidor calcula si el disparo impacta (rayo contra cajas de colisión) y resta la vida. El cliente nunca dice "le di". |
| **Wallhack** (ver a través de paredes) | El servidor **no envía la posición** de los enemigos que no puedes ver. El dato nunca llega al navegador. |
| **Teletransporte** | La posición la calcula el servidor; el cliente solo la predice. Si miente, el servidor lo corrige. |
| **Lag switch** (cortar la red para "congelarse") | Si un jugador deja de enviar inputs, el servidor lo sigue simulando: cae y se queda quieto. |
| **Mensajes basura / flood** | Se validan tipos y rangos, se limitan los mensajes por segundo, y quien insiste es expulsado. |
| **Nombres maliciosos** | Se limpian en el servidor (solo letras, números y algunos símbolos; máximo 16 caracteres). |

Para que el juego se sienta fluido a pesar de todo esto:

- **Predicción del cliente:** tu personaje se mueve al instante en tu pantalla, usando la misma física que el servidor. Cuando llega la respuesta oficial, se corrige suavemente.
- **Interpolación:** los demás jugadores se dibujan con 100 ms de retraso, para que se muevan sin saltos.
- **Compensación de latencia:** al calcular un disparo, el servidor "rebobina" a los demás jugadores a donde tú los veías, con un límite de 300 ms.

**Lo que ningún servidor puede impedir del todo es el aimbot** (apuntado automático). Se puede detectar con estadísticas y reportes; eso queda para una fase posterior.

## Pruebas

```bash
npm test
```

Las pruebas levantan un servidor real y conectan jugadores falsos para comprobar:

- la entrada a la partida;
- la limpieza de nombres;
- el anti speed hack;
- el movimiento normal;
- la expulsión por inputs basura;
- el disparo y la muerte calculados por el servidor;
- el anti wallhack;
- el límite de cadencia de disparo.

## Hoja de ruta

- [x] **Fase 1:** servidor autoritativo, movimiento, disparos, muertes, rondas y anti-trampas básico.
- [ ] **Fase 2:** registro e inicio de sesión con Supabase. El servidor solo acepta jugadores con una sesión válida.
- [ ] **Fase 3:** publicar en internet: cliente en Cloudflare Pages y servidor en Oracle Cloud (gratis) o en un VPS.
- [ ] Más adelante:
  - más armas y mapas;
  - estadísticas guardadas;
  - detección de aimbot;
  - controles táctiles para móvil.

## Notas técnicas

- **Colyseus 0.16:** se usa por estabilidad. `npm audit` avisa de una versión vieja de `nanoid` dentro de Colyseus, que solo es un problema con tamaños inválidos, y Colyseus no los usa. Se resolverá al migrar a Colyseus 0.18.
- **Dirección del servidor en producción:** se configura con la variable `VITE_SERVER_URL` (ver `client/.env.example`).
