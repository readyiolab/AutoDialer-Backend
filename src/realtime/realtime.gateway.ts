import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { resolveJwtSecret } from '../common/utils/jwt-secret';

const realtimeCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: {
    origin: realtimeCorsOrigins.length > 0 ? realtimeCorsOrigins : false,
    credentials: realtimeCorsOrigins.length > 0,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private jwt = new JwtService({ secret: resolveJwtSecret() });

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers.authorization || '').replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwt.verify(token);
      const companyId = payload.companyId;
      client.data.userId = payload.userId;
      client.data.companyId = companyId;
      client.join(`company:${companyId}`);
      client.join(`user:${payload.userId}`);
      this.logger.debug(`Socket connected user=${payload.userId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Socket disconnected ${client.id}`);
  }

  emitToCompany(companyId: string, event: string, data: unknown) {
    this.server?.to(`company:${companyId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: unknown) {
    this.server?.to(`user:${userId}`).emit(event, data);
  }
}
