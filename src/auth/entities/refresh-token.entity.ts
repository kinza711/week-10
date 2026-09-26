import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // SHA-256 hash of the raw refresh token. The raw token is handed to the
  // client exactly once (at issuance) and is never persisted.
  @Column({ name: 'token_hash' })
  tokenHash: string;

  // Carries every token born from the same login through each rotation.
  // Used by reuse detection (Challenge X1): if a revoked token is presented
  // again, every token sharing its family is revoked, because two parties
  // are now holding tokens meant for one.
  @Column({ name: 'family_id' })
  familyId: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
