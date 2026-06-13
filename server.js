require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Chess } = require('chess.js');
const { Server } = require('socket.io');

/* =====================================================
   FAIL FAST
===================================================== */

if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI missing');
  process.exit(1);
}

const PORT = process.env.PORT || 3001;

/* =====================================================
   EXPRESS
===================================================== */

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET','POST','PATCH']
}));

app.use(express.json({
  limit:'1mb'
}));

const server = http.createServer(app);

const io = new Server(server,{
  cors:{
    origin:'*'
  },

  pingTimeout:60000,
  pingInterval:25000
});

/* =====================================================
   DATABASE
===================================================== */

mongoose.connect(

process.env.MONGO_URI,

{

maxPoolSize:20,

minPoolSize:5

}

)

.then(()=>{

console.log('✅ Mongo Connected');

})

.catch(err=>{

console.error(

'❌ Mongo Error',

err.message

);

process.exit(1);

});

/* =====================================================
   HELPERS
===================================================== */

function genId(){

return crypto

.randomBytes(4)

.toString('hex');

}

function genToken(){

return crypto

.randomBytes(32)

.toString('hex');

}

function hashPassword(password){

return crypto

.createHash('sha256')

.update(password)

.digest('hex');

}

function sanitizeUser(user){

const obj=

user.toObject

?

user.toObject()

:

user;

delete obj.passwordHash;

return obj;

}

/* =====================================================
   DEFAULT RATINGS
===================================================== */

function defaultNormalRatings(){

return{

bullet_30s:400,

bullet_1m:400,

bullet_2m:400,

bullet_2p3:400,

blitz_3m:400,

blitz_5m:400,

blitz_5p5:400,

rapid_7m:400,

rapid_10m:400,

rapid_15m:400,

rapid_15p5:400,

classical_30m:400

};

}

function defaultPhoenixRatings(){

return{

blitz_4m:400,

blitz_5m:400,

blitz_5p6:400,

rapid_7m:400,

rapid_10m:400,

rapid_15m:400,

rapid_15p5:400,

classical_30m:400

};

}

/* =====================================================
   TIME KEYS
===================================================== */

function getTimeKey(

seconds,

increment=0

){

if(

seconds===30

&&

increment===0

)

return{

mode:'normal',

cat:'bullet_30s'

};

if(

seconds===60

&&

increment===0

)

return{

mode:'normal',

cat:'bullet_1m'

};

if(

seconds===120

&&

increment===0

)

return{

mode:'normal',

cat:'bullet_2m'

};

if(

seconds===120

&&

increment===3

)

return{

mode:'normal',

cat:'bullet_2p3'

};

if(

seconds===180

&&

increment===0

)

return{

mode:'normal',

cat:'blitz_3m'

};

if(

seconds===300

&&

increment===0

)

return{

mode:'normal',

cat:'blitz_5m'

};

if(

seconds===300

&&

increment===5

)

return{

mode:'normal',

cat:'blitz_5p5'

};

if(

seconds===420

&&

increment===0

)

return{

mode:'normal',

cat:'rapid_7m'

};

if(

seconds===600

&&

increment===0

)

return{

mode:'normal',

cat:'rapid_10m'

};

if(

seconds===900

&&

increment===0

)

return{

mode:'normal',

cat:'rapid_15m'

};

if(

seconds===900

&&

increment===5

)

return{

mode:'normal',

cat:'rapid_15p5'

};

if(

seconds===1800

&&

increment===0

)

return{

mode:'normal',

cat:'classical_30m'

};

return{

mode:'normal',

cat:'blitz_5m'

};

}

/* =====================================================
   PHOENIX TIME KEYS
===================================================== */

function getPhoenixTimeKey(

seconds,

increment=0

){

if(

seconds===240

&&

increment===0

)

return{

mode:'phoenix',

cat:'blitz_4m'

};

if(

seconds===300

&&

increment===0

)

return{

mode:'phoenix',

cat:'blitz_5m'

};

if(

seconds===300

&&

increment===6

)

return{

mode:'phoenix',

cat:'blitz_5p6'

};

if(

seconds===420

&&

increment===0

)

return{

mode:'phoenix',

cat:'rapid_7m'

};

if(

seconds===600

&&

increment===0

)

return{

mode:'phoenix',

cat:'rapid_10m'

};

if(

seconds===900

&&

increment===0

)

return{

mode:'phoenix',

cat:'rapid_15m'

};

if(

seconds===900

&&

increment===5

)

return{

mode:'phoenix',

cat:'rapid_15p5'

};

if(

seconds===1800

&&

increment===0

)

return{

mode:'phoenix',

cat:'classical_30m'

};

return{

mode:'phoenix',

cat:'blitz_5m'

};

}

/* =====================================================
   ELO
===================================================== */

function calcElo(

player,

opponent,

score

){

const K=32;

const expected=

1/

(

1+

Math.pow(

10,

(opponent-player)/400

)

);

return Math.round(

player+

K*

(

score-

expected

)

);

}

/* =====================================================
   TIERS
===================================================== */

function getTier(rating){

if(rating<800)

return{

name:'Beginner',

emoji:'🌱'

};

if(rating<1300)

return{

name:'Intermediate',

emoji:'⭐'

};

if(rating<1800)

return{

name:'Advanced',

emoji:'⚔️'

};

if(rating<2200)

return{

name:'Master',

emoji:'👑'

};

return{

name:'Grandmaster',

emoji:'🔥'

};

}

/* =====================================================
   PGN GENERATOR
===================================================== */

function generatePGN(

game,

result

){

const date=

new Date()

.toISOString()

.split('T')[0];

let pgnResult='*';

if(result==='win')

pgnResult='1-0';

else if(

result==='loss'

)

pgnResult='0-1';

else if(

result==='draw'

)

pgnResult='1/2-1/2';

const moves=

game

.chess

.history({

verbose:true

})

.map(

(m,i)=>{

if(

i%2===0

)

return

`${

Math.floor(

i/2

)+1

}. ${m.san}`;

return m.san;

}

)

.join(' ');

return

`[Event "Phoenix Chess"]

[Site "Phoenix"]

[Date "${date}"]

[White "${game.usernames.w}"]

[Black "${game.usernames.b}"]

[Result "${pgnResult}"]

[TimeControl "${game.timerSeconds}+${game.increment}"]

${moves}

${pgnResult}`;

}

/* =====================================================
   SCHEMAS
===================================================== */

const UserSchema=

new mongoose.Schema({

username:{

type:String,

required:true,

unique:true,

lowercase:true

},

passwordHash:{

type:String,

required:true

},

email:{

type:String,

default:null,

lowercase:true

},

phone:{

type:String,

default:null

},

displayName:String,

bio:{

type:String,

default:''

},

country:{

type:String,

default:''

},

flair:{

type:String,

default:''

},

profilePic:{

type:String,

default:null

},

createdAt:{

type:Number,

default:Date.now

},

ratings:{

type:

mongoose

.Schema

.Types

.Mixed,

default:()=>({

normal:

defaultNormalRatings(),

phoenix:

defaultPhoenixRatings()

})

},

peakRatings:{

type:

mongoose

.Schema

.Types

.Mixed,

default:()=>({

normal:

defaultNormalRatings(),

phoenix:

defaultPhoenixRatings()

})

},

stats:{

type:

mongoose

.Schema

.Types

.Mixed,

default:()=>({

normal:{

wins:0,

losses:0,

draws:0

},

phoenix:{

wins:0,

losses:0,

draws:0

}

})

},

matchHistory:{

type:Array,

default:[]

},

winStreak:{

type:Number,

default:0

},

bestWinStreak:{

type:Number,

default:0

}

},

{

minimize:false

}

);

/* =====================================================
   UNIQUE EMAIL
===================================================== */

UserSchema.index(

{

email:1

},

{

unique:true,

partialFilterExpression:{

email:{

$type:

"string"

}

}

}

);

/* =====================================================
   SESSION SCHEMA
===================================================== */

const SessionSchema=

new mongoose.Schema({

token:{

type:String,

required:true,

unique:true,

index:true

},

username:{

type:String,

required:true,

lowercase:true

},

createdAt:{

type:Date,

default:Date.now,

expires:604800

},

lastActivity:{

type:Date,

default:Date.now

},

ipAddress:String,

userAgent:String

});

const User=

mongoose.model(

'User',

UserSchema

);

const Session=

mongoose.model(

'Session',

SessionSchema

);

/* =====================================================
   MEMORY
===================================================== */

const games={};

const waitingPlayers={

normal:[],

phoenix:[]

};

const socketToGame={};

const RATE_LIMIT={

moves:50,

window:10000

};

const moveTracker={};

/* =====================================================
   AUTH MIDDLEWARE
===================================================== */

async function

authMiddleware(

req,

res,

next

){

const token=

req

.headers

.authorization

?.replace(

'Bearer ',

''

);

if(!token)

return

res

.status(401)

.json({

error:

'Unauthorized'

});

try{

const session=

await

Session

.findOne({

token

});

if(!session)

return

res

.status(401)

.json({

error:

'Invalid Session'

});

session

.lastActivity=

new Date();

await

session.save();

req.username=

session.username;

req.token=token;

next();

}

catch(err){

res

.status(500)

.json({

error:

'Auth Failed'

});

}

}

/* =====================================================
   REGISTER
===================================================== */

app.post(

'/auth/register',

async(

req,

res

)=>{

try{

const{

username,

password,

email,

phone

}

=req.body;

if(

!username||

!password

)

return

res

.status(400)

.json({

error:

'Username and password required'

});

const exists=

await

User

.findOne({

username:

username

.toLowerCase()

});

if(exists)

return

res

.status(400)

.json({

error:

'Username Taken'

});

const user=

new User({

username:

username

.toLowerCase(),

passwordHash:

hashPassword(

password

),

email:

email||

null,

phone:

phone||

null,

displayName:

username

});

await

user.save();

const token=

genToken();

await

new Session({

token,

username:

user.username,

ipAddress:

req.ip,

userAgent:

req.headers

['user-agent']

})

.save();

res.json({

token,

user:

sanitizeUser(

user

)

});

}

catch(err){

res

.status(500)

.json({

error:

err.message

});

}

});

/* =====================================================
   LOGIN
===================================================== */

app.post(

'/auth/login',

async(

req,

res

)=>{

try{

const{

username,

password

}

=req.body;

const user=

await User.findOne({

$or:[

{

username:

username

?.toLowerCase()

},

{

email:

username

?.toLowerCase()

},

{

phone:

username

}

]

});

if(

!user||

user.passwordHash

!==

hashPassword(

password

)

){

return res

.status(401)

.json({

error:

'Invalid Credentials'

});

}

const token=

genToken();

await

new Session({

token,

username:

user.username,

ipAddress:

req.ip,

userAgent:

req.headers

['user-agent']

})

.save();

res.json({

token,

user:

sanitizeUser(

user

)

});

}

catch(err){

res

.status(500)

.json({

error:

'Login Failed'

});

}

});

/* =====================================================
   LOGOUT
===================================================== */

app.post(

'/auth/logout',

authMiddleware,

async(

req,

res

)=>{

try{

await

Session.deleteOne({

token:

req.token

});

res.json({

success:true

});

}

catch(err){

res

.status(500)

.json({

error:

'Logout Failed'

});

}

});

/* =====================================================
   VERIFY
===================================================== */

app.post(

'/auth/verify',

authMiddleware,

async(

req,

res

)=>{

try{

const user=

await User.findOne({

username:

req.username

});

if(!user)

return

res

.status(404)

.json({

error:

'User Not Found'

});

res.json({

valid:true,

user:

sanitizeUser(

user

)

});

}

catch(err){

res

.status(500)

.json({

error:

'Verify Failed'

});

}

});

/* =====================================================
   PROFILE
===================================================== */

app.get(

'/profile/:username',

async(

req,

res

)=>{

try{

const user=

await User.findOne({

username:

req

.params

.username

.toLowerCase()

});

if(!user)

return

res

.status(404)

.json({

error:

'User Not Found'

});

res.json(

sanitizeUser(

user

)

);

}

catch(err){

res

.status(500)

.json({

error:

'Profile Failed'

});

}

});

/* =====================================================
   LEADERBOARD
===================================================== */

app.get(

'/leaderboard/:mode/:cat',

async(

req,

res

)=>{

try{

const{

mode,

cat

}

=req.params;

const users=

await

User.find({});

const ranked=

users

.filter(

u=>

u

.ratings

?.[mode]

?.[cat]

!==

undefined

)

.sort(

(a,b)=>

b

.ratings

[mode]

[cat]

-

a

.ratings

[mode]

[cat]

)

.slice(

0,

100

)

.map(

(u,i)=>({

rank:

i+1,

username:

u.username,

displayName:

u.displayName,

country:

u.country,

rating:

u

.ratings

[mode]

[cat],

tier:

getTier(

u

.ratings

[mode]

[cat]

)

})

);

res.json(

ranked

);

}

catch(err){

res

.status(500)

.json({

error:

'Leaderboard Failed'

});

}

});

/* =====================================================
   MATCH HISTORY
===================================================== */

app.get(

'/history/:username',

async(

req,

res

)=>{

try{

const user=

await User.findOne({

username:

req

.params

.username

.toLowerCase()

});

if(!user)

return

res

.status(404)

.json({

error:

'User Not Found'

});

res.json(

user

.matchHistory

.slice(-100)

.reverse()

);

}

catch(err){

res

.status(500)

.json({

error:

'History Failed'

});

}

});

/* =====================================================
   CREATE GAME
===================================================== */

function createGame(

socket1,

socket2,

mode,

timerSeconds,

increment

){

const gameId=

genId();

const chess=

new Chess();

const p1White=

Math.random()

>

0.5;

games[gameId]={

id:gameId,

mode,

chess,

timerSeconds,

increment,

timeKey:

mode==='phoenix'

?

getPhoenixTimeKey(

timerSeconds,

increment

)

:

getTimeKey(

timerSeconds,

increment

),

players:{

w:

p1White

?

socket1.id

:

socket2.id,

b:

p1White

?

socket2.id

:

socket1.id

},

usernames:{

w:

p1White

?

socket1.username

:

socket2.username,

b:

p1White

?

socket2.username

:

socket1.username

},

timers:{

w:

timerSeconds,

b:

timerSeconds

},

timerInterval:null,

started:false,

illegalMoves:{

w:0,

b:0

},

createdAt:

Date.now()

};

socketToGame

[socket1.id]

=

gameId;

socketToGame

[socket2.id]

=

gameId;

return{

gameId,

colors:{

[socket1.id]:

p1White

?

'w'

:

'b',

[socket2.id]:

p1White

?

'b'

:

'w'

}

};

}

/* =====================================================
   TIMER
===================================================== */

function startTimer(

gameId

){

const g=

games

[gameId];

if(!g)

return;

clearInterval(

g.timerInterval

);

g.timerInterval=

setInterval(()=>{

const turn=

g.chess.turn();

g.timers

[turn]--;

io

.to(

gameId

)

.emit(

'timerUpdate',

g.timers

);

if(

g.timers

[turn]

<=0

){

clearInterval(

g.timerInterval

);

const winner=

turn==='w'

?

'b'

:

'w';

endGame(

gameId,

winner,

'Time Out'

);

}

},1000);

}

/* =====================================================
   ELO UPDATE
===================================================== */

async function updateRatings(

winnerUsername,

loserUsername,

mode,

cat

){

try{

const winner=

await User.findOne({

username:

winnerUsername

});

const loser=

await User.findOne({

username:

loserUsername

});

if(

!winner||

!loser

)

return;

const wr=

winner

.ratings

[mode]

[cat]

||400;

const lr=

loser

.ratings

[mode]

[cat]

||400;

winner

.ratings

[mode]

[cat]

=

calcElo(

wr,

lr,

1

);

loser

.ratings

[mode]

[cat]

=

calcElo(

lr,

wr,

0

);

winner

.stats

[mode]

.wins++;

loser

.stats

[mode]

.losses++;

winner

.winStreak++;

loser

.winStreak=0;

winner

.bestWinStreak=

Math.max(

winner.bestWinStreak,

winner.winStreak

);

winner.markModified(

'ratings'

);

loser.markModified(

'ratings'

);

await winner.save();

await loser.save();

}

catch(err){

console.error(

'Rating Crash',

err

);

}

}

/* =====================================================
   END GAME
===================================================== */

async function endGame(

gameId,

winnerColor,

reason

){

const g=

games

[gameId];

if(!g)

return;

clearInterval(

g.timerInterval

);

const loserColor=

winnerColor==='w'

?

'b'

:

'w';

const{

mode,

cat

}

=

g.timeKey;

await updateRatings(

g.usernames[winnerColor],

g.usernames[loserColor],

mode,

cat

);

const pgn=

generatePGN(

g,

winnerColor==='w'

?

'win'

:

'loss'

);

const history=

g.chess.history({

verbose:true

});

for(

const c

of

['w','b']

){

const user=

await User.findOne({

username:

g.usernames[c]

});

if(user){

user.matchHistory.push({

gameId,

date:

Date.now(),

result:

c===winnerColor

?

'win'

:

'loss',

opponent:

g.usernames

[

c==='w'

?

'b'

:

'w'

],

pgn,

moves:

history,

reason

});

user.markModified(

'matchHistory'

);

await user.save();

}

}

io

.to(

gameId

)

.emit(

'gameOver',

{

winner:

winnerColor,

reason,

fen:

g.chess.fen()

}

);

delete

socketToGame

[

g.players.w

];

delete

socketToGame

[

g.players.b

];

delete

games

[gameId];

}

/* =====================================================
   SOCKET.IO
===================================================== */

io.on(

'connection',

(socket)=>{

console.log(

'🟢',

socket.id

);

/* AUTH */

socket.on(

'authenticate',

async({

token

})=>{

try{

const session=

await

Session.findOne({

token

});

if(!session)

return;

socket.username=

session.username;

socket.emit(

'authenticated',

{

username:

session.username

}

);

}

catch{}

});

/* FIND GAME */

socket.on(

'findGame',

({

mode='normal',

timerSeconds=600,

increment=0

})=>{

if(

!socket.username

)

return;

const queue=

waitingPlayers

[mode];

const opponent=

queue.shift();

if(opponent){

const{

gameId,

colors

}

=

createGame(

socket,

opponent,

mode,

timerSeconds,

increment

);

socket.join(

gameId

);

opponent.join(

gameId

);

socket.emit(

'gameFound',

{

gameId,

color:

colors

[socket.id]

}

);

opponent.emit(

'gameFound',

{

gameId,

color:

colors

[opponent.id]

}

);

games

[gameId]

.started=true;

startTimer(

gameId

);

}

else{

queue.push(

socket

);

socket.emit(

'waiting'

);

}

});

/* CANCEL */

socket.on(

'cancelSearch',

()=>{

for(

const m

of

['normal','phoenix']

){

waitingPlayers

[m]

=

waitingPlayers

[m]

.filter(

s=>

s.id

!==

socket.id

);

}

});

/* MOVE */

socket.on(

'makeMove',

({

gameId,

from,

to,

promotion

})=>{

const g=

games

[gameId];

if(!g)

return;

const color=

g.players.w

===

socket.id

?

'w'

:

'b';

if(

g.chess.turn()

!==

color

)

return;

try{

const move=

g.chess.move({

from,

to,

promotion:

promotion

||

'q'

});

if(!move){

g.illegalMoves

[color]++;

return;

}

if(

g.increment

>

0

)

g.timers

[color]

+=

g.increment;

io

.to(

gameId

)

.emit(

'moveMade',

{

from:

move.from,

to:

move.to,

fen:

g.chess.fen(),

turn:

g.chess.turn(),

history:

g

.chess

.history({

verbose:true

}),

timers:

g.timers,

check:

g.chess.inCheck(),

checkmate:

g.chess.isCheckmate(),

draw:

g.chess.isDraw()

}

);

if(

g.chess.isCheckmate()

)

endGame(

gameId,

color,

'Checkmate'

);

else if(

g.chess.isDraw()

){

io

.to(

gameId

)

.emit(

'gameOver',

{

winner:null,

reason:'Draw'

});

delete

games

[gameId];

}

}

catch(err){

console.error(

err

);

}

});

/* RESIGN */

socket.on(

'resign',

({

gameId

})=>{

const g=

games

[gameId];

if(!g)

return;

const loser=

g.players.w

===

socket.id

?

'w'

:

'b';

const winner=

loser==='w'

?

'b'

:

'w';

endGame(

gameId,

winner,

'Resignation'

);

});

/* DRAW */

socket.on(

'offerDraw',

({

gameId

})=>{

socket

.to(

gameId

)

.emit(

'drawOffered'

);

});

socket.on(

'respondDraw',

({

gameId,

accept

})=>{

if(

accept

){

io

.to(

gameId

)

.emit(

'gameOver',

{

winner:null,

reason:

'Draw Agreement'

});

delete

games

[gameId];

}

else{

socket

.to(

gameId

)

.emit(

'drawDeclined'

);

}

});

/* RECONNECT */

socket.on(

'reconnectGame',

({

gameId

})=>{

const g=

games

[gameId];

if(

!g||

!socket.username

)

return;

let color=null;

if(

g.usernames.w

===

socket.username

){

g.players.w=

socket.id;

color='w';

}

if(

g.usernames.b

===

socket.username

){

g.players.b=

socket.id;

color='b';

}

if(color){

socket.join(

gameId

);

socket.emit(

'gameRecovered',

{

gameId,

color,

fen:

g.chess.fen(),

timers:

g.timers,

history:

g.chess.history({

verbose:true

})

}

);

}

});

/* DISCONNECT */

socket.on(

'disconnect',

()=>{

for(

const m

of

['normal','phoenix']

){

waitingPlayers

[m]

=

waitingPlayers

[m]

.filter(

s=>

s.id

!==

socket.id

);

}

const gameId=

socketToGame

[socket.id];

if(!gameId)

return;

const g=

games

[gameId];

if(!g)

return;

setTimeout(()=>{

const gg=

games

[gameId];

if(!gg)

return;

if(

gg.players.w

===

socket.id||

gg.players.b

===

socket.id

){

const loser=

gg.players.w

===

socket.id

?

'w'

:

'b';

const winner=

loser==='w'

?

'b'

:

'w';

endGame(

gameId,

winner,

'Disconnected'

);

}

},30000);

});

});

/* =====================================================
   HEALTH
===================================================== */

app.get(

'/',

async(

req,

res

)=>{

res.json({

status:

'Phoenix Chess V6+',

database:

mongoose

.connection

.readyState===1,

activeGames:

Object.keys(

games

).length,

normalQueue:

waitingPlayers

.normal

.length,

phoenixQueue:

waitingPlayers

.phoenix

.length

});

});

/* =====================================================
   REDIS SCALING HOOK

npm i ioredis
npm i @socket.io/redis-adapter

const { createAdapter }
= require('@socket.io/redis-adapter');

const Redis =
require('ioredis');

const pub =
new Redis(process.env.REDIS_URL);

const sub =
pub.duplicate();

io.adapter(
createAdapter(pub,sub)
);

===================================================== */

/* =====================================================
   START
===================================================== */

server.listen(

PORT,

()=>{

console.log(

'🚀 Phoenix Chess V6+ Started'

);

console.log(

'🌍 Port:',

PORT

);

console.log(

'📊 Active Games:',

Object.keys(

games

).length

);

console.log(

'✅ Production Ready'

);

});
