import { DurableObject } from 'cloudflare:workers';
import { generateQuestion, normaliseQuestionConfig, publicQuestion } from './questions.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeName(value) {
  const name = String(value || '').trim().replace(/[<>]/g, '').slice(0, 20);
  return name || 'Raider';
}

function safeClientId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function startingPosition(index) {
  return 6 + ((index * 13) % 88);
}

export class RaidRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.room = null;

    this.ctx.blockConcurrencyWhile(async () => {
      this.room = (await this.ctx.storage.get('room')) || null;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') {
      return this.createRoom(request);
    }

    if (url.pathname === '/state' && request.method === 'GET') {
      if (!this.room) return json({ error: 'Raid not found' }, 404);
      return json(this.publicState());
    }

    if (url.pathname === '/report' && request.method === 'GET') {
      if (!this.room) return json({ error: 'Raid not found' }, 404);
      if (url.searchParams.get('key') !== this.room.teacherKey) {
        return json({ error: 'Not authorised' }, 403);
      }
      return json(this.teacherReport());
    }

    if (url.pathname === '/start' && request.method === 'POST') {
      if (!this.room) return json({ error: 'Raid not found' }, 404);
      if (url.searchParams.get('key') !== this.room.teacherKey) {
        return json({ error: 'Not authorised' }, 403);
      }
      const result = await this.startRaid();
      return json(result, result.error ? 409 : 200);
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.acceptSocket(request);
    }

    return json({ error: 'Not found' }, 404);
  }

  async createRoom(request) {
    if (this.room) return json({ error: 'Raid code already exists' }, 409);

    const body = await request.json().catch(() => ({}));
    const questionConfig = normaliseQuestionConfig(body.topic, body.difficulty);

    this.room = {
      version: 1,
      code: body.code,
      teacherKey: randomKey(),
      status: 'lobby',
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      outcome: null,
      config: {
        mode: body.mode === 'individual' ? 'individual' : 'ranked',
        subject: 'math',
        topic: questionConfig.topic,
        difficulty: questionConfig.difficulty,
        boss: body.boss || 'numberzilla'
      },
      boss: {
        id: body.boss || 'numberzilla',
        name: 'Numberzilla',
        maxHealth: 300,
        health: 300
      },
      raidHealth: 100,
      maxRaidHealth: 100,
      players: {},
      team: {
        questions: 0,
        correct: 0,
        bossAttacks: 0
      }
    };

    await this.saveRoom();
    return json({ ok: true, teacherKey: this.room.teacherKey }, 201);
  }

  async acceptSocket(request) {
    if (!this.room) return json({ error: 'Raid not found' }, 404);

    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (role === 'teacher') {
      if (url.searchParams.get('key') !== this.room.teacherKey) {
        return json({ error: 'Not authorised' }, 403);
      }

      this.ctx.acceptWebSocket(server, ['teacher']);
      server.serializeAttachment({ role: 'teacher' });
      this.safeSend(server, { type: 'teacher_state', report: this.teacherReport() });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role !== 'student') return json({ error: 'Invalid socket role' }, 400);

    const clientId = safeClientId(url.searchParams.get('clientId')) || crypto.randomUUID();
    let player = Object.values(this.room.players).find((entry) => entry.clientId === clientId);

    if (!player) {
      const playerIndex = Object.keys(this.room.players).length;
      if (playerIndex >= 60) {
        return json({ error: 'This raid is full' }, 409);
      }

      player = {
        id: crypto.randomUUID(),
        clientId,
        name: safeName(url.searchParams.get('name')),
        class: url.searchParams.get('class') === 'healer' ? 'healer' : 'dps',
        x: startingPosition(playerIndex),
        joinedAt: Date.now(),
        attempted: 0,
        correct: 0,
        wrong: 0,
        totalResponseMs: 0,
        currentQuestion: null,
        wrongTimestamps: [],
        stunnedUntil: 0
      };
      this.room.players[player.id] = player;

      if (this.room.status === 'running') {
        player.currentQuestion = this.newQuestion();
      }

      await this.saveRoom();
    } else {
      player.name = safeName(url.searchParams.get('name') || player.name);
      player.class = url.searchParams.get('class') === 'healer' ? 'healer' : 'dps';
    }

    this.ctx.acceptWebSocket(server, ['students', `player:${player.id}`]);
    server.serializeAttachment({ role: 'student', playerId: player.id });

    this.safeSend(server, {
      type: 'connected',
      playerId: player.id,
      state: this.publicState(),
      question: this.room.status === 'running' ? publicQuestion(player.currentQuestion) : null
    });

    this.broadcastPublic();
    this.sendTeacherState();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let event;
    try {
      event = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      this.safeSend(ws, { type: 'error', message: 'Invalid message' });
      return;
    }

    const attachment = ws.deserializeAttachment();
    if (!attachment) return;

    if (attachment.role === 'teacher') {
      if (event.type === 'start_raid') {
        const result = await this.startRaid();
        if (result.error) this.safeSend(ws, { type: 'error', message: result.error });
      }
      return;
    }

    const player = this.room?.players?.[attachment.playerId];
    if (!player) return;

    if (event.type === 'answer') {
      await this.handleAnswer(ws, player, event);
      return;
    }

    if (event.type === 'move') {
      const direction = event.direction === 'left' ? -1 : event.direction === 'right' ? 1 : 0;
      if (!direction) return;
      player.x = clamp(player.x + direction * 5, 4, 96);
      this.broadcast({ type: 'player_move', playerId: player.id, x: player.x });
      return;
    }

    if (event.type === 'jump') {
      this.broadcast({ type: 'player_jump', playerId: player.id });
    }
  }

  async startRaid() {
    if (!this.room) return { error: 'Raid not found' };
    if (this.room.status !== 'lobby') return { error: 'Raid has already started' };

    const players = Object.values(this.room.players);
    if (!players.length) return { error: 'At least one student must join before starting' };

    this.room.status = 'running';
    this.room.startedAt = Date.now();
    this.room.boss.maxHealth = Math.max(300, players.length * 100);
    this.room.boss.health = this.room.boss.maxHealth;
    this.room.raidHealth = this.room.maxRaidHealth;

    for (const player of players) {
      player.currentQuestion = this.newQuestion();
      player.stunnedUntil = 0;
      player.wrongTimestamps = [];
    }

    await this.saveRoom();

    this.broadcast({ type: 'raid_started', state: this.publicState() });
    for (const player of players) this.sendQuestion(player);
    this.sendTeacherState();

    return { ok: true };
  }

  async handleAnswer(ws, player, event) {
    if (this.room.status !== 'running' || !player.currentQuestion) return;

    const now = Date.now();
    if (player.stunnedUntil > now) {
      this.safeSend(ws, { type: 'stunned', until: player.stunnedUntil });
      return;
    }

    const question = player.currentQuestion;
    if (event.questionId !== question.id) return;

    const answer = Number(event.answer);
    const correct = answer === question.correctAnswer;
    const responseMs = Math.max(0, now - question.issuedAt);

    player.attempted += 1;
    player.totalResponseMs += responseMs;
    this.room.team.questions += 1;

    let damage = 0;
    let healing = 0;
    let bossAttack = 0;

    if (correct) {
      player.correct += 1;
      player.wrongTimestamps = [];
      this.room.team.correct += 1;

      if (player.class === 'healer') {
        damage = 6;
        healing = 4;
        this.room.raidHealth = Math.min(this.room.maxRaidHealth, this.room.raidHealth + healing);
      } else {
        damage = 10;
      }

      this.room.boss.health = Math.max(0, this.room.boss.health - damage);

      if (this.room.team.correct % 12 === 0 && this.room.boss.health > 0) {
        bossAttack = 8;
        this.room.team.bossAttacks += 1;
        this.room.raidHealth = Math.max(0, this.room.raidHealth - bossAttack);
      }
    } else {
      player.wrong += 1;
      player.wrongTimestamps = player.wrongTimestamps.filter((timestamp) => timestamp >= now - 6000);
      player.wrongTimestamps.push(now);

      if (player.wrongTimestamps.length >= 3) {
        player.stunnedUntil = now + 2000;
        player.wrongTimestamps = [];
      }
    }

    if (this.room.boss.health <= 0) {
      this.finishRaid('victory');
    } else if (this.room.raidHealth <= 0) {
      this.finishRaid('defeat');
    } else {
      player.currentQuestion = this.newQuestion();
    }

    await this.saveRoom();

    this.safeSend(ws, {
      type: 'answer_result',
      correct,
      correctAnswer: question.correctAnswer,
      damage,
      healing,
      stunnedUntil: player.stunnedUntil > now ? player.stunnedUntil : null,
      nextQuestion: this.room.status === 'running' ? publicQuestion(player.currentQuestion) : null
    });

    if (bossAttack) {
      this.broadcast({ type: 'boss_attack', damage: bossAttack, raidHealth: this.room.raidHealth });
    }

    this.broadcastPublic();
    this.sendTeacherState();

    if (this.room.status === 'complete') {
      this.broadcast({ type: 'raid_complete', outcome: this.room.outcome, state: this.publicState() });
    }
  }

  finishRaid(outcome) {
    this.room.status = 'complete';
    this.room.outcome = outcome;
    this.room.endedAt = Date.now();
    for (const player of Object.values(this.room.players)) player.currentQuestion = null;
  }

  newQuestion() {
    return generateQuestion(this.room.config.topic, this.room.config.difficulty);
  }

  sendQuestion(player) {
    const payload = { type: 'question', question: publicQuestion(player.currentQuestion) };
    for (const ws of this.ctx.getWebSockets(`player:${player.id}`)) this.safeSend(ws, payload);
  }

  publicState() {
    if (!this.room) return null;
    const teamAccuracy = this.room.team.questions
      ? Math.round((this.room.team.correct / this.room.team.questions) * 1000) / 10
      : 0;

    return {
      code: this.room.code,
      status: this.room.status,
      outcome: this.room.outcome,
      config: this.room.config,
      boss: this.room.boss,
      raidHealth: this.room.raidHealth,
      maxRaidHealth: this.room.maxRaidHealth,
      team: {
        questions: this.room.team.questions,
        correct: this.room.team.correct,
        accuracy: teamAccuracy
      },
      players: Object.values(this.room.players).map((player) => ({
        id: player.id,
        name: player.name,
        class: player.class,
        x: player.x
      }))
    };
  }

  teacherReport() {
    if (!this.room) return null;
    return {
      ...this.publicState(),
      createdAt: this.room.createdAt,
      startedAt: this.room.startedAt,
      endedAt: this.room.endedAt,
      students: Object.values(this.room.players).map((player) => ({
        id: player.id,
        name: player.name,
        class: player.class,
        attempted: player.attempted,
        correct: player.correct,
        wrong: player.wrong,
        accuracy: player.attempted ? Math.round((player.correct / player.attempted) * 1000) / 10 : 0,
        averageResponseMs: player.attempted ? Math.round(player.totalResponseMs / player.attempted) : 0
      }))
    };
  }

  broadcastPublic() {
    this.broadcast({ type: 'state', state: this.publicState() });
  }

  sendTeacherState() {
    const payload = { type: 'teacher_state', report: this.teacherReport() };
    for (const ws of this.ctx.getWebSockets('teacher')) this.safeSend(ws, payload);
  }

  broadcast(payload) {
    for (const ws of this.ctx.getWebSockets()) this.safeSend(ws, payload);
  }

  safeSend(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // The runtime will clean up disconnected sockets.
    }
  }

  async saveRoom() {
    await this.ctx.storage.put('room', this.room);
  }

  webSocketClose() {
    // Close handshakes are automatically handled for this compatibility date.
  }

  webSocketError() {
    // Disconnected sockets are omitted from getWebSockets().
  }
}
