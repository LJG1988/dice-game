const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // 生产环境请限制域名
    methods: ["GET", "POST"]
  }
});

// 静态托管前端页面（可选，方便开发）
app.use(express.static(__dirname));

// ---------- 游戏状态存储 ----------
// 当前在线的玩家，以角色名作为唯一键，保证一个角色只能被一人使用
const players = new Map(); // key: role, value: { socketId, role }

// 记录每个 socket.id 对应的角色，方便断开时清理
const socketToRole = new Map(); // key: socketId, value: role

// 当前回合的就绪状态，存储已点击「扔」的角色名
const readySet = new Set();

// 固定角色列表（与前段保持一致）
const FIXED_ROLES = ['建广', '建国', '李川', '凯宁', '鸿晓'];

// ---------- 辅助函数 ----------
// 生成5个1-6的随机数
function generateDicePoints() {
  return Array.from({ length: 5 }, () => Math.floor(Math.random() * 6) + 1);
}

// 广播当前在线玩家列表
function broadcastPlayers() {
  const playerList = Array.from(players.values()).map(p => ({ role: p.role }));
  io.emit('playersUpdate', playerList);
}

// 检查是否所有在线玩家都已就绪，若是则触发掷骰
function tryStartRoll() {
  const onlineRoles = Array.from(players.keys());
  // 所有在线角色都必须就绪，且至少有一人在线
  const allReady = onlineRoles.length > 0 && onlineRoles.every(role => readySet.has(role));
  
  if (allReady) {
    // 为本局每一个在线角色生成骰子点数
    const roundPoints = {};
    onlineRoles.forEach(role => {
      roundPoints[role] = generateDicePoints();
    });

    // 广播开始掷骰，并附带所有角色的点数
    io.emit('startRoll', { roundPoints });

    // 清空就绪状态，准备下一轮
    readySet.clear();
  }
}

// ---------- Socket.IO 连接处理 ----------
io.on('connection', (socket) => {
  console.log(`玩家连接: ${socket.id}`);

  // 1. 客户端请求选择角色
  socket.on('selectRole', ({ role }) => {
    // 校验角色是否合法
    if (!FIXED_ROLES.includes(role)) {
      socket.emit('roleAssigned', { success: false, message: '无效的角色' });
      return;
    }

    // 检查角色是否已被占用
    if (players.has(role)) {
      socket.emit('roleAssigned', { success: false, message: '该角色已被选走' });
      return;
    }

    // 检查该 socket 是否已经选过角色（不允许切换）
    if (socketToRole.has(socket.id)) {
      socket.emit('roleAssigned', { success: false, message: '你已经选择过角色，不能更换' });
      return;
    }

    // 分配角色
    const player = { socketId: socket.id, role };
    players.set(role, player);
    socketToRole.set(socket.id, role);

    // 通知客户端分配成功
    socket.emit('roleAssigned', { success: true, role });

    // 广播最新的玩家列表
    broadcastPlayers();

    console.log(`角色分配: ${role} (${socket.id})`);
  });

  // 2. 客户端准备就绪（点击扔）
  socket.on('playerReady', ({ role }) => {
    // 校验角色是否在线，且属于该 socket
    const player = players.get(role);
    if (!player || player.socketId !== socket.id) {
      socket.emit('errorMsg', { message: '你不是该角色或角色不在线' });
      return;
    }

    // 添加到就绪集合
    readySet.add(role);
    console.log(`角色就绪: ${role}，当前就绪: ${Array.from(readySet)}`);

    // 可选：通知其他玩家谁已就绪（前端未使用，但可以扩展）
    socket.broadcast.emit('someoneReady', { role });

    // 尝试触发掷骰
    tryStartRoll();
  });

  // 3. 处理断开连接
  socket.on('disconnect', () => {
    console.log(`玩家断开: ${socket.id}`);

    // 获取该 socket 对应的角色
    const role = socketToRole.get(socket.id);
    if (role) {
      // 从玩家列表中移除
      players.delete(role);
      socketToRole.delete(socket.id);

      // 同时从就绪集合中移除（如果存在）
      if (readySet.has(role)) {
        readySet.delete(role);
      }

      // 广播更新后的玩家列表
      broadcastPlayers();

      console.log(`角色离线: ${role}`);
    }
  });
});

// ---------- 启动服务器 ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});