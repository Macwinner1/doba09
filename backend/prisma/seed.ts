import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_QUIZ = {
  title: 'Feyi Demo Quiz',
  description: 'A short quiz for trying out a live game.',
  questions: [
    {
      text: 'What is the capital of Nigeria?',
      timeLimit: 20,
      points: 1000,
      choices: ['Abuja', 'Lagos', 'Kano', 'Ibadan'],
      correct: 0,
    },
    {
      text: 'Which planet is known as the Red Planet?',
      timeLimit: 15,
      points: 1000,
      choices: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
      correct: 1,
    },
    {
      text: 'HTTP status 404 means the resource was not found.',
      timeLimit: 10,
      points: 1000,
      choices: ['True', 'False'],
      correct: 0,
      type: 'TRUE_FALSE' as const,
    },
    {
      text: 'Which of these is NOT a JavaScript runtime?',
      timeLimit: 20,
      points: 2000,
      choices: ['Node.js', 'Deno', 'Bun', 'Django'],
      correct: 3,
    },
    {
      text: 'What does the "S" in HTTPS stand for?',
      timeLimit: 15,
      points: 1000,
      choices: ['Simple', 'Secure', 'Standard', 'Static'],
      correct: 1,
    },
  ],
};

async function main(): Promise<void> {
  const email = 'demo@feyi.local';

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Demo Host',
      passwordHash: await bcrypt.hash('Demo1234', 12),
    },
  });

  // Idempotent: re-seeding replaces the demo quiz rather than piling up copies.
  await prisma.quiz.deleteMany({ where: { ownerId: user.id, title: DEMO_QUIZ.title } });

  await prisma.quiz.create({
    data: {
      ownerId: user.id,
      title: DEMO_QUIZ.title,
      description: DEMO_QUIZ.description,
      visibility: 'PUBLIC',
      questions: {
        create: DEMO_QUIZ.questions.map((q, qIndex) => ({
          order: qIndex,
          type: q.type ?? 'MULTIPLE_CHOICE',
          text: q.text,
          timeLimit: q.timeLimit,
          points: q.points,
          choices: {
            create: q.choices.map((text, cIndex) => ({
              order: cIndex,
              text,
              isCorrect: cIndex === q.correct,
            })),
          },
        })),
      },
    },
  });

  console.log(`Seeded demo host ${email} (password: Demo1234) with "${DEMO_QUIZ.title}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
