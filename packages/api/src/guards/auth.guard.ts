import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // For MVP: allow all requests. In production: validate DID signature/JWT
    return true;
  }
}
