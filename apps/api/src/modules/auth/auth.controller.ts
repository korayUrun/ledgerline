import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  LoginBodySchema,
  type LoginBody,
  type LoginResponseDto,
  type UserDto,
} from "@ledgerline/schemas";
import { ZodBodyPipe } from "../../common/zod-body.pipe.js";
import { bearerToken, Public, type AuthenticatedRequest } from "./auth.guard.js";
import { AuthService, toUserDto } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  // 200 rather than 201: the client logs in, it does not create a resource it
  // will address later.
  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodBodyPipe(LoginBodySchema)) body: LoginBody): Promise<LoginResponseDto> {
    return this.auth.login(body.email, body.password);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    const token = bearerToken(request);
    if (token) {
      await this.auth.logout(token);
    }
  }

  @Get("me")
  me(@Req() request: AuthenticatedRequest): UserDto {
    if (!request.user) {
      throw new UnauthorizedException("Log in first.");
    }
    return toUserDto(request.user);
  }
}
