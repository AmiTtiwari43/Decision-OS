import mongoose from 'mongoose';
import {
  UserModel,
  type UserDocument,
  type IUser,
  type UserRole,
} from '../models/index.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
  role?: UserRole;
  isActive?: boolean;
}

export class UserRepository {
  /**
   * Persists a new user record.
   */
  async create(data: CreateUserInput): Promise<UserDocument> {
    const doc = new UserModel({
      email: data.email.toLowerCase().trim(),
      passwordHash: data.passwordHash,
      name: data.name.trim(),
      role: data.role || 'user',
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
    await doc.save();
    return doc;
  }

  /**
   * Finds a user by email (case-insensitive).
   */
  async findByEmail(email: string): Promise<UserDocument | null> {
    if (!email || typeof email !== 'string') return null;
    return UserModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  /**
   * Finds a user by MongoDB ObjectId string.
   */
  async findById(id: string): Promise<UserDocument | null> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return null;
    }
    return UserModel.findById(id).exec();
  }

  /**
   * Updates an existing user by ObjectId string.
   */
  async update(id: string, updates: Partial<IUser>): Promise<UserDocument | null> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return null;
    }
    const updatePayload = { ...updates };
    delete (updatePayload as Record<string, unknown>)._id;
    delete (updatePayload as Record<string, unknown>).createdAt;

    return UserModel.findByIdAndUpdate(
      id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).exec();
  }

  /**
   * Deletes a user by ObjectId.
   */
  async delete(id: string): Promise<boolean> {
    if (!id || typeof id !== 'string' || !mongoose.isValidObjectId(id)) {
      return false;
    }
    const result = await UserModel.findByIdAndDelete(id).exec();
    return result !== null;
  }
}

export const userRepository = new UserRepository();

