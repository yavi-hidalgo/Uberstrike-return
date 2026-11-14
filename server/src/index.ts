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

gameServer.define("arena", ArenaRoom);

gameServer.listen(port).then(() => {
  console.log(`Servidor de juego escuchando en ws://localhost:${port}`);
});
