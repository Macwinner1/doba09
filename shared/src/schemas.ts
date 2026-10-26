import { z } from 'zod';
import {
  MAX_CHOICES,
  MAX_TIME_LIMIT,
  MIN_CHOICES,
  MIN_TIME_LIMIT,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  PIN_LENGTH,
  POINTS_OPTIONS,
} from './constants.js';

/**
 * One set of schemas, used by the Nest validation pipe, the socket gateway and
 * the React forms. If a rule lives here it cannot drift between the two apps.
 */

export const pinSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `PIN must be ${PIN_LENGTH} digits`);

export const nicknameSchema = z
  .string()
  .trim()
  .min(NICKNAME_MIN_LENGTH, `At least ${NICKNAME_MIN_LENGTH} characters`)
  .max(NICKNAME_MAX_LENGTH, `At most ${NICKNAME_MAX_LENGTH} characters`)
  // Letters, digits, spaces and a few separators. Blocking punctuation keeps
  // markup and control characters out of the projected lobby screen.
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'Letters, numbers, spaces, _ . - only');

export const questionTypeSchema = z.enum(['MULTIPLE_CHOICE', 'TRUE_FALSE']);

export const choiceInputSchema = z.object({
  text: z.string().trim().min(1, 'Answer cannot be empty').max(120),
  isCorrect: z.boolean(),
});

export const questionInputSchema = z
  .object({
    type: questionTypeSchema.default('MULTIPLE_CHOICE'),
    text: z.string().trim().min(1, 'Question cannot be empty').max(280),
    imageUrl: z.string().url().nullable().optional(),
    timeLimit: z.number().int().min(MIN_TIME_LIMIT).max(MAX_TIME_LIMIT),
    points: z.union([
      z.literal(POINTS_OPTIONS[0]),
      z.literal(POINTS_OPTIONS[1]),
      z.literal(POINTS_OPTIONS[2]),
    ]),
    choices: z.array(choiceInputSchema).min(MIN_CHOICES).max(MAX_CHOICES),
  })
  .superRefine((q, ctx) => {
    const correctCount = q.choices.filter((c) => c.isCorrect).length;
    if (correctCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices'],
        message: 'Exactly one answer must be marked correct',
      });
    }
    if (q.type === 'TRUE_FALSE' && q.choices.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['choices'],
        message: 'True/false questions need exactly 2 answers',
      });
    }
  });

export const quizInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  description: z.string().trim().max(500).optional().default(''),
  coverImage: z.string().url().nullable().optional(),
  visibility: z.enum(['PRIVATE', 'PUBLIC']).default('PRIVATE'),
  questions: z.array(questionInputSchema).min(1, 'Add at least one question'),
});

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(80),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[a-z]/, 'Needs a lowercase letter')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/\d/, 'Needs a number'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
});

/** Same password rules as registration — reset must not be a way to weaken one. */
const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a number');

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: passwordSchema,
});

export const playerJoinSchema = z.object({
  pin: pinSchema,
  nickname: nicknameSchema,
});

export const playerAnswerSchema = z.object({
  questionId: z.string().min(1),
  choiceIndex: z.number().int().min(0).max(MAX_CHOICES - 1),
  clientElapsedMs: z.number().int().min(0).max(MAX_TIME_LIMIT * 1000 + 5000),
});

export type QuizInput = z.infer<typeof quizInputSchema>;
export type QuestionInput = z.infer<typeof questionInputSchema>;
export type ChoiceInput = z.infer<typeof choiceInputSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
