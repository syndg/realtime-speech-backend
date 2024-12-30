// SPDX-FileCopyrightText: 2024 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0
import { type JobContext, WorkerOptions, cli, defineAgent, llm, multimodal } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import dotenv from 'dotenv';
import { RpcInvocationData } from 'livekit-client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../.env.local');
dotenv.config({ path: envPath });

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    console.log('waiting for participant');
    const participant = await ctx.waitForParticipant();
    console.log(`starting assistant example agent for ${participant.identity}`);

    const participantMetadata = participant.metadata;
    const initialConfig = JSON.parse(participantMetadata);

    const model = new openai.realtime.RealtimeModel({
      instructions: initialConfig.instructions,
      modalities: ['text', 'audio'],
      voice: initialConfig.voice,
      temperature: initialConfig.temperature,
      maxResponseOutputTokens: Infinity,
      turnDetection: JSON.parse(initialConfig.turn_detection),
      model: "gpt-4o-mini-realtime-preview-2024-12-17"
    });

    const fncCtx: llm.FunctionContext = {
      weather: {
        description: 'Get the weather in a location',
        parameters: z.object({
          location: z.string().describe('The location to get the weather for'),
        }),
        execute: async ({ location }) => {
          console.debug(`executing weather function for ${location}`);
          const response = await fetch(`https://wttr.in/${location}?format=%C+%t`);
          if (!response.ok) {
            throw new Error(`Weather API returned status: ${response.status}`);
          }
          const weather = await response.text();
          return `The weather in ${location} right now is ${weather}.`;
        },
      },
    };

    ctx.room.localParticipant?.registerRpcMethod(
      'pg.updateConfig',
      async (data: RpcInvocationData) => {
        if (data.callerIdentity !== participant.identity) return JSON.stringify({ changed: false });

        const newConfig = JSON.parse(data.payload);

        session.sessionUpdate({
          instructions: newConfig.instructions,
          modalities: ['text', 'audio'],
          voice: newConfig.voice,
          temperature: parseFloat(newConfig.temperature),
          maxResponseOutputTokens: Infinity,
          turnDetection: JSON.parse(newConfig.turn_detection),
        });

        return JSON.stringify({ changed: true });
      },
    );

    const agent = new multimodal.MultimodalAgent({ model, fncCtx });
    const session = await agent
      .start(ctx.room, participant)
      .then((session) => session as openai.realtime.RealtimeSession);

    session.conversation.item.create(
      llm.ChatMessage.create({
        role: llm.ChatRole.ASSISTANT,
        text: 'How can I help you today?',
      }),
    );

    session.response.create();
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
