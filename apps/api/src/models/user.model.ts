import mongoose, { Schema, type Model } from 'mongoose';
import type { UserDocument, IUser } from './user.types.js';

export const UserSchema = new Schema<IUser, Model<UserDocument>>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [255, 'Email cannot exceed 255 characters'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    role: {
      type: String,
      enum: {
        values: ['user', 'admin'],
        message: 'Role must be either user or admin',
      },
      default: 'user',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = (ret._id as mongoose.Types.ObjectId)?.toString?.() || ret._id;
        delete ret._id;
        delete ret.__v;
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

export const UserModel =
  (mongoose.models.User as Model<UserDocument>) ||
  mongoose.model<UserDocument>('User', UserSchema);
