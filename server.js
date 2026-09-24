const express=require("express"),session=require("express-session"),bcrypt=require("bcryptjs"),DB=require("better-sqlite3"),http=require("http"),{Server}=require("socket.io"),path=require("path"),fs=require("fs");
const app=express(),server=http.createServer(app),io=new Server(server);
const dbPath=process.env.DB_PATH||"albertsons.db";
if(dbPath.includes("/")) fs.mkdirSync(path.dirname(dbPath),{recursive:true});
const db=new DB(dbPath);
const OWNER="nitishkumar.nin@gmail.com",PORT=process.env.PORT||3000,SECRET=process.env.SESSION_SECRET||"CHANGE_ME_ALBERTSONS_SECRET";
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS project(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,email TEXT UNIQUE,password_hash TEXT,role TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS epics(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,description TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS features(id INTEGER PRIMARY KEY AUTOINCREMENT,epic_id INTEGER,title TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS pbis(id INTEGER PRIMARY KEY AUTOINCREMENT,feature_id INTEGER,title TEXT,priority TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS sprints(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,start_date TEXT,end_date TEXT,goal TEXT,state TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,pbi_id INTEGER,title TEXT,assignee_id INTEGER,sprint_id INTEGER,priority TEXT,status TEXT,description TEXT,acceptance_criteria TEXT,created_at TEXT,updated_at TEXT);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id INTEGER,author_id INTEGER,text TEXT,created_at TEXT);
CREATE TABLE IF NOT EXISTS meetings(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,title TEXT,meeting_date TEXT,meeting_time TEXT,duration INTEGER,attendees TEXT,link TEXT,agenda TEXT,created_by INTEGER,created_at TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_id INTEGER,action TEXT,created_at TEXT);
`);
const now=()=>new Date().toISOString();
if(!db.prepare("SELECT 1 FROM project WHERE id=1").get())db.prepare("INSERT INTO project VALUES(1,?)").run("Albertsons Retail Data Modernization");
if(!db.prepare("SELECT 1 FROM users WHERE lower(email)=lower(?)").get(OWNER)){db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)").run("Nitish Kumar",OWNER,bcrypt.hashSync("Nin@12345",12),"Owner",now())} else { db.prepare("UPDATE users SET password_hash=? WHERE lower(email)=lower(?)").run(bcrypt.hashSync("Nin@12345",12), OWNER); }
app.use(express.json());app.use(session({secret:SECRET,resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000}}));app.use(express.static(path.join(__dirname,"public")));
function me(req){return req.session.user&&db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(req.session.user.id)}
function auth(req,res,next){req.user=me(req);if(!req.user)return res.status(401).json({error:"Login required"});next()}
function owner(req,res,next){if(req.user.role!=="Owner"||req.user.email.toLowerCase()!==OWNER)return res.status(403).json({error:"Owner access required"});next()}
function audit(req,msg){db.prepare("INSERT INTO audit(actor_id,action,created_at) VALUES(?,?,?)").run(req.user.id,msg,now());io.emit("changed")}
const simple={
 epics:["title","description"],features:["epic_id","title"],pbis:["feature_id","title","priority"],
 sprints:["name","start_date","end_date","goal","state"]
};
app.get("/health",(q,s)=>s.json({ok:true,app:"Albertsons Shared Scrum"}));
app.get("/api/me",(q,s)=>s.json({user:me(q),owner:OWNER}));
app.post("/api/owner/setup",async(q,s)=>{
  const email=String(q.body.email||"").trim().toLowerCase(), password=String(q.body.password||"");
  if(email!==OWNER.toLowerCase()) return s.status(403).json({error:"Owner email does not match"});
  if(password.length<8) return s.status(400).json({error:"Password must be at least 8 characters"});
  const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)").get(OWNER);
  if(!u) return s.status(500).json({error:"Owner account is missing"});
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(password,12),u.id);
  q.session.user={id:u.id};
  s.json({user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});
app.post("/api/login",(q,s)=>{let e=String(q.body.email||"").toLowerCase().trim(),p=String(q.body.password||"");let u=db.prepare("SELECT * FROM users WHERE lower(email)=?").get(e);if(!u||!bcrypt.compareSync(p,u.password_hash))return s.status(401).json({error:"Invalid email or password"});q.session.user={id:u.id};s.json({user:{id:u.id,name:u.name,email:u.email,role:u.role}})});
app.post("/api/logout",(q,s)=>q.session.destroy(()=>s.json({ok:true})));
app.get("/api/state",auth,(q,s)=>s.json({
project:db.prepare("SELECT * FROM project WHERE id=1").get(),
users:db.prepare("SELECT id,name,email,role FROM users ORDER BY id").all(),
epics:db.prepare("SELECT * FROM epics ORDER BY id").all(),
features:db.prepare("SELECT * FROM features ORDER BY id").all(),
pbis:db.prepare("SELECT * FROM pbis ORDER BY id").all(),
sprints:db.prepare("SELECT * FROM sprints ORDER BY id").all(),
tasks:db.prepare("SELECT t.*,u.name assignee_name,s.name sprint_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id LEFT JOIN sprints s ON s.id=t.sprint_id ORDER BY t.id").all(),
comments:db.prepare("SELECT c.*,u.name author_name,u.email author_email FROM comments c JOIN users u ON u.id=c.author_id ORDER BY c.id").all(),
meetings:db.prepare("SELECT * FROM meetings ORDER BY meeting_date,meeting_time").all(),
audit:db.prepare("SELECT a.*,u.name actor_name,u.email actor_email FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 300").all()
}));
for(const [type,fields] of Object.entries(simple)){
 app.post("/api/"+type,auth,owner,(q,s)=>{let vals=fields.map(f=>q.body[f]??"");let marks=fields.map(()=>"?").join(",");let r=db.prepare(`INSERT INTO ${type}(${fields.join(",")},created_at) VALUES(${marks},?)`).run(...vals,now());audit(q,`Created ${type}: ${q.body.title||q.body.name}`);s.json({id:r.lastInsertRowid})});
 app.delete("/api/"+type+"/:id",auth,owner,(q,s)=>{db.prepare(`DELETE FROM ${type} WHERE id=?`).run(+q.params.id);audit(q,`Deleted ${type} #${q.params.id}`);s.json({ok:true})});
}
app.post("/api/users",auth,owner,(q,s)=>{let {name,email,password,role="Developer"}=q.body;if(!name||!email||!password||password.length<8)return s.status(400).json({error:"Name, email and password (8+ chars) required"});try{let r=db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)").run(name,email.toLowerCase(),bcrypt.hashSync(password,12),role,now());audit(q,`Added user ${email}`);s.json({id:r.lastInsertRowid})}catch(e){s.status(400).json({error:"Email already exists"})}});
app.delete("/api/users/:id",auth,owner,(q,s)=>{let u=db.prepare("SELECT * FROM users WHERE id=?").get(+q.params.id);if(!u||u.email.toLowerCase()===OWNER)return s.status(400).json({error:"Cannot delete owner"});db.prepare("DELETE FROM users WHERE id=?").run(u.id);audit(q,`Removed user ${u.email}`);s.json({ok:true})});
app.post("/api/sprints/:id/start",auth,owner,(q,s)=>{db.prepare("UPDATE sprints SET state='Closed' WHERE state='Active' AND id<>?").run(+q.params.id);db.prepare("UPDATE sprints SET state='Active' WHERE id=?").run(+q.params.id);audit(q,"Started Sprint #"+q.params.id);s.json({ok:true})});
app.post("/api/sprints/:id/close",auth,owner,(q,s)=>{db.prepare("UPDATE sprints SET state='Closed' WHERE id=?").run(+q.params.id);audit(q,"Closed Sprint #"+q.params.id);s.json({ok:true})});
app.post("/api/tasks",auth,owner,(q,s)=>{let b=q.body,r=db.prepare(`INSERT INTO tasks(pbi_id,title,assignee_id,sprint_id,priority,status,description,acceptance_criteria,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(b.pbi_id,b.title,b.assignee_id||null,b.sprint_id||null,b.priority||"Medium","To Do",b.description||"",b.acceptance_criteria||"",now(),now());audit(q,`Created task "${b.title}" and assigned it`);s.json({id:r.lastInsertRowid})});
app.delete("/api/tasks/:id",auth,owner,(q,s)=>{db.prepare("DELETE FROM tasks WHERE id=?").run(+q.params.id);audit(q,`Deleted task #${q.params.id}`);s.json({ok:true})});
app.patch("/api/tasks/:id/status",auth,(q,s)=>{let t=db.prepare("SELECT * FROM tasks WHERE id=?").get(+q.params.id);if(!t)return s.status(404).json({error:"Task not found"});if(q.user.role!=="Owner"&&t.assignee_id!==q.user.id)return s.status(403).json({error:"Only the assignee or owner can change status"});let v=q.body.status;if(!["To Do","In Progress","Testing","Done"].includes(v))return s.status(400).json({error:"Invalid status"});db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(v,now(),t.id);audit(q,`Task "${t.title}" changed to ${v}`);s.json({ok:true})});
app.post("/api/tasks/:id/comments",auth,(q,s)=>{let text=String(q.body.text||"").trim();if(!text)return s.status(400).json({error:"Comment required"});let r=db.prepare("INSERT INTO comments(task_id,author_id,text,created_at) VALUES(?,?,?,?)").run(+q.params.id,q.user.id,text,now());audit(q,`Added comment to task #${q.params.id}`);s.json({id:r.lastInsertRowid})});
app.delete("/api/comments/:id",auth,(q,s)=>{let c=db.prepare("SELECT * FROM comments WHERE id=?").get(+q.params.id);if(!c)return s.status(404).json({error:"Comment not found"});if(q.user.role!=="Owner"&&c.author_id!==q.user.id)return s.status(403).json({error:"Only your own comment can be deleted"});db.prepare("DELETE FROM comments WHERE id=?").run(c.id);audit(q,`Deleted comment #${c.id}`);s.json({ok:true})});
app.post("/api/meetings",auth,owner,(q,s)=>{let b=q.body;let r=db.prepare("INSERT INTO meetings(type,title,meeting_date,meeting_time,duration,attendees,link,agenda,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(b.type,b.title,b.meeting_date,b.meeting_time,+b.duration||15,b.attendees||"",b.link||"",b.agenda||"",q.user.id,now());audit(q,`Scheduled meeting "${b.title}"`);s.json({id:r.lastInsertRowid})});
app.delete("/api/meetings/:id",auth,owner,(q,s)=>{db.prepare("DELETE FROM meetings WHERE id=?").run(+q.params.id);audit(q,`Deleted meeting #${q.params.id}`);s.json({ok:true})});
app.delete("/api/audit/:id",auth,owner,(q,s)=>{db.prepare("DELETE FROM audit WHERE id=?").run(+q.params.id);io.emit("changed");s.json({ok:true})});
app.delete("/api/audit",auth,owner,(q,s)=>{db.prepare("DELETE FROM audit").run();io.emit("changed");s.json({ok:true})});
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public/index.html")));
server.listen(PORT,()=>console.log("Albertsons shared app on "+PORT));