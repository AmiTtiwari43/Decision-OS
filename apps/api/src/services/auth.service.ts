import { userRepository, type UserRepository } from '../repositories/user.repository.js';
import { hashPassword, verifyPassword, dummyVerifyPassword } from '../utils/crypto.js';
import {
  UserAlreadyExistsError,
  InvalidCredentialsError,
  UnauthorizedError,
} from '../errors/domain.errors.js';
import type {
  RegisterInput,
  LoginInput,
  UserPublicDto,
  UserDocument,
} from '../models/user.types.js';

/**
 * Transforms an internal UserDocument into a safe public DTO.
 * Explicitly excludes passwordHash and other internal properties.
 */
export function toUserPublicDto(user: UserDocument): UserPublicDto {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export class AuthService {
  constructor(private repo: UserRepository = userRepository) {}

  /**
   * Registers a new user.
   * Rejects if email is already registered.
   */
  async register(input: RegisterInput): Promise<UserPublicDto> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const existing = await this.repo.findByEmail(normalizedEmail);
    if (existing) {
      throw new UserAlreadyExistsError('A user with this email address already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.create({
      email: normalizedEmail,
      passwordHash,
      name: input.name.trim(),
      role: 'user',
    });

    return toUserPublicDto(user);
  }

  /**
   * Authenticates a user with email and password.
   * Employs constant-time dummy verification when user is not found
   * to prevent email enumeration timing side channels.
   */
  async login(input: LoginInput): Promise<UserPublicDto> {
    const normalizedEmail = input.email.toLowerCase().trim();
    const user = await this.repo.findByEmail(normalizedEmail);

    if (!user || !user.isActive) {
      await dummyVerifyPassword(input.password);
      throw new InvalidCredentialsError('Invalid email or password');
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new InvalidCredentialsError('Invalid email or password');
    }

    return toUserPublicDto(user);
  }

  /**
   * Retrieves the current user profile by authenticated ID.
   */
  async getCurrentUser(userId: string): Promise<UserPublicDto> {
    const user = await this.repo.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('User session is invalid or user is inactive');
    }
    return toUserPublicDto(user);
  }
}

export const authService = new AuthService();

