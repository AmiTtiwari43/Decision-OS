import type { Types } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IUser {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDocument extends IUser {
  _id: Types.ObjectId;
}

export interface UserPublicDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  user: UserPublicDto;
  token: string;
}

