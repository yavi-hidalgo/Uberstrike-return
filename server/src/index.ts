import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ArenaRoom } from "./ArenaRoom";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({
    pingInterval: 5000,
    pingMaxRetries: 3,
    maxPayload: 4 * 1024, // ningún mensaje legítimo del cliente pesa más de esto
  }),
});

// Una partida distinta por mapa: quien elige la fábrica no cae en la estación
gameServer.define("arena", ArenaRoom).filterBy(["map"]);

gameServer.listen(port).then(() => {
  console.log(`Servidor de juego escuchando en ws://localhost:${port}`);
});
