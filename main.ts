import { Hono } from "https://deno.land/x/hono@v4.2.3/mod.ts";
import { cors, jwt } from "https://deno.land/x/hono@v4.2.3/middleware.ts";
import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";
import {
  compare as comparePromise,
  compareSync,
  hash as hashPromise,
  hashSync,
} from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { decode, sign } from "https://deno.land/x/hono@v4.2.3/utils/jwt/jwt.ts";

const app = new Hono();
const kv = await Deno.openKv();
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "secret";
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["POST", "PUT", "PATCH", "GET", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    maxAge: 600,
    credentials: true,
  }),
);

app.use("/auth/*", jwt({ secret: JWT_SECRET }));

const isRunningInDenoDeploy = (globalThis as any).Worker === undefined;

const hashFn: typeof hashPromise = isRunningInDenoDeploy
  ? (plaintext: string, salt: string | undefined = undefined) =>
    new Promise((res) => res(hashSync(plaintext, salt)))
  : hashPromise;

const compareFn: typeof comparePromise = isRunningInDenoDeploy
  ? (plaintext: string, hash: string) =>
    new Promise((res) => res(compareSync(plaintext, hash)))
  : comparePromise;

interface Todo {
  id: string;
  content: string;
  isChecked: boolean;
}

interface User {
  id: string;
  username: string;
  password: string;
}

app.get("/", (c) => {
  return c.text("Hello, Deno!");
});

app.get("/auth", (c) => {
  return c.text("Hello, Deno Auth!");
});

app.post("/signup", async (c) => {
  const body = await c.req.json();
  const res = await kv.get<User>(["users", body.username]);
  if (res.value !== null) {
    c.status(400);
    return c.json({ code: 400, message: "user already exists", data: null });
  }
  const id = ulid();
  const hash = await hashFn(body.password);
  await kv.set(["users", body.username], {
    id,
    username: body.username,
    password: hash,
  });
  return c.json({ code: 200, message: "user creation success", data: null });
});

app.post("/login", async (c) => {
  const body = await c.req.json();
  const res = await kv.get<User>(["users", body.username]);
  if (res.value === null) {
    c.status(400);
    return c.json({ code: 400, message: "user not found", data: null });
  }
  const password = res.value?.password;
  const isValid = await compareFn(body.password, password);
  if (!isValid) {
    c.status(400);
    return c.json({ code: 400, message: "password is incorrect", data: null });
  }

  const currentTime = Math.floor(Date.now() / 1000);
  const payload = {
    id: res.value.id,
    username: res.value.username,
    exp: currentTime + 60 * 5,
  };
  const accessToken = await sign(payload, JWT_SECRET);
  const refreshToken = await sign(
    { exp: currentTime + 7 * 24 * 60 * 60 },
    JWT_SECRET,
  );

  await kv.set(["refresh-tokens", res.value.id], refreshToken);

  return c.json({
    code: 200,
    message: "login success",
    data: { ...payload, accessToken, refreshToken },
  });
});

app.post("/auth/logout", async (c) => {
  const payload = c.get("jwtPayload");
  await kv.delete(["refresh-tokens", payload.id]);
  return c.json({ code: 200, message: "logout success", data: null });
});

app.post("/refresh", async (c) => {
  const body = await c.req.json();
  const { payload } = decode(body.accessToken);
  const refreshToken = await kv.get<string>(["refresh-tokens", payload.id]);
  if (refreshToken.value === null) {
    c.status(400);
    return c.json({
      code: 400,
      message: "refresh token not found",
      data: null,
    });
  }
  if (body.refreshToken !== refreshToken.value) {
    c.status(400);
    return c.json({
      code: 400,
      message: "refresh token is invalid",
      data: null,
    });
  }
  const { payload: newPayload } = decode(refreshToken.value);
  const currentTime = Math.floor(Date.now() / 1000);
  if (newPayload.exp < currentTime) {
    c.status(400);
    return c.json({
      code: 400,
      message: "refresh token is expired",
      data: null,
    });
  }
  const exp = Math.floor(Date.now() / 1000) + 60 * 5;
  const newAccessToken = await sign({ ...payload, exp }, JWT_SECRET);
  return c.json({
    code: 200,
    message: "refresh success",
    data: { accessToken: newAccessToken, exp },
  });
});

app.get("/todo", async (c) => {
  const pageStr = c.req.query("page");
  const page = pageStr ? parseInt(pageStr) : 1;
  const filter = c.req.query("filter");
  const itemSize = 6;
  const startIndex = (page - 1) * itemSize; //info: page starts with 1
  const endIndex = startIndex + itemSize;
  const iter = kv.list<Todo>({ prefix: ["todo-list"] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  let total = todos.length;
  let returnTodos = todos.slice(startIndex, endIndex);
  switch (filter) {
    case "all":
      break;
    case "checked":
      {
        returnTodos = todos.filter((todo) => todo.isChecked).slice(
          startIndex,
          endIndex,
        );
        total = todos.filter((todo) => todo.isChecked).length;
      }
      break;
    case "unchecked":
      {
        returnTodos = todos.filter((todo) => !todo.isChecked).slice(
          startIndex,
          endIndex,
        );
        total = todos.filter((todo) => !todo.isChecked).length;
      }
      break;
    default:
      break;
  }
  const totalPage = Math.ceil(total / itemSize);
  return c.json({
    code: 200,
    message: "success",
    data: { todos: returnTodos, totalPage },
  });
});

app.get("/todo/dashboard", async (c) => {
  const iter = kv.list<Todo>({ prefix: ["todo-list"] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  const total = todos.length;
  const finished = todos.filter((todo) => todo.isChecked).length;
  const left = total - finished;
  const progress = (finished / total) * 100;
  return c.json({
    code: 200,
    message: "success",
    data: { progress, finished, left },
  });
});

app.post("/todo/create", async (c) => {
  const body = await c.req.json();
  if (body.content === "") {
    c.status(400);
    return c.json({ code: 400, message: "content is required", data: null });
  }
  const id = ulid();
  const result = await kv.set(
    ["todo-list", id],
    { id, content: body.content, isChecked: false } as Todo,
  );
  return c.json({ code: 200, message: "todo creation success", data: result });
});

app.patch("/todo/update/:id", async (c) => {
  const body = await c.req.json();
  const id = c.req.param("id");
  const todo = await kv.get<Todo>(["todo-list", id]);
  if (todo === undefined) {
    return c.json({ code: 404, message: "todo not found", data: null });
  }
  const result = await kv.set(["todo-list", id], {
    ...todo.value,
    isChecked: body.isChecked,
  });
  return c.json({ code: 200, message: "todo update success", data: result });
});

app.delete("/todo/delete/:id", async (c) => {
  const id = c.req.param("id");
  await kv.delete(["todo-list", id]);
  return c.json({ code: 200, message: "todo delete success", data: null });
});

app.get("/auth/todo", async (c) => {
  const payload = c.get("jwtPayload");
  const pageStr = c.req.query("page");
  const page = pageStr ? parseInt(pageStr) : 1;
  const filter = c.req.query("filter");
  const itemSize = 6;
  const startIndex = (page - 1) * itemSize; //info: page starts with 1
  const endIndex = startIndex + itemSize;
  const iter = kv.list<Todo>({ prefix: ["todo-list", "users", payload.id] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  let total = todos.length;
  let returnTodos = todos.slice(startIndex, endIndex);
  switch (filter) {
    case "all":
      break;
    case "checked":
      {
        returnTodos = todos.filter((todo) => todo.isChecked).slice(
          startIndex,
          endIndex,
        );
        total = todos.filter((todo) => todo.isChecked).length;
      }
      break;
    case "unchecked":
      {
        returnTodos = todos.filter((todo) => !todo.isChecked).slice(
          startIndex,
          endIndex,
        );
        total = todos.filter((todo) => !todo.isChecked).length;
      }
      break;
    default:
      break;
  }
  const totalPage = Math.ceil(total / itemSize);
  return c.json({
    code: 200,
    message: "success",
    data: { todos: returnTodos, totalPage },
  });
});

app.get("/auth/todo/dashboard", async (c) => {
  const payload = c.get("jwtPayload");
  const iter = kv.list<Todo>({ prefix: ["todo-list", "users", payload.id] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  const total = todos.length;
  const finished = todos.filter((todo) => todo.isChecked).length;
  const left = total - finished;
  const progress = (finished / total) * 100;
  return c.json({
    code: 200,
    message: "success",
    data: { progress, finished, left },
  });
});

app.post("/auth/todo/create", async (c) => {
  const payload = c.get("jwtPayload");
  const body = await c.req.json();
  if (body.content === "") {
    c.status(400);
    return c.json({ code: 400, message: "content is required", data: null });
  }
  const id = ulid();
  const result = await kv.set(
    ["todo-list", "users", payload.id, id],
    { id, content: body.content, isChecked: false } as Todo,
  );
  return c.json({ code: 200, message: "todo creation success", data: result });
});

app.patch("/auth/todo/update/:id", async (c) => {
  const payload = c.get("jwtPayload");
  const body = await c.req.json();
  const id = c.req.param("id");
  const todo = await kv.get<Todo>(["todo-list", "users", payload.id, id]);
  if (todo === undefined) {
    return c.json({ code: 404, message: "todo not found", data: null });
  }
  const result = await kv.set(["todo-list", "users", payload.id, id], {
    ...todo.value,
    isChecked: body.isChecked,
  });
  return c.json({ code: 200, message: "todo update success", data: result });
});

app.delete("/auth/todo/delete/:id", async (c) => {
  const payload = c.get("jwtPayload");
  const id = c.req.param("id");
  await kv.delete(["todo-list", "users", payload.id, id]);
  return c.json({ code: 200, message: "todo delete success", data: null });
});

Deno.serve(app.fetch);
