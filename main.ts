import { Hono } from "https://deno.land/x/hono@v4.2.3/mod.ts";
import { cors } from "https://deno.land/x/hono@v4.2.3/middleware.ts";
import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";

const app = new Hono();
const kv = await Deno.openKv();

app.use(
  "/*",
  cors({
    origin: Deno.env.get("CORS_ORIGIN") || "",
    allowMethods: ["POST", "PUT", "PATCH", "GET", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "X-Kuma-Revision"],
    maxAge: 600,
    credentials: true,
  }),
);

interface Todo {
  id: string;
  content: string;
  isChecked: boolean;
}

app.get("/", (c) => {
  return c.text("Hello, Deno!");
});

app.get("/todo", async (c) => {
  const pageStr = c.req.query("page");
  const page = parseInt(pageStr ?? "1");
  const filter = c.req.query("filter") ?? "all";
  const itemSize = 6;
  const startIndex = (page - 1) * itemSize; //info: page starts with 1
  const endIndex = startIndex + itemSize;

  const todos: Todo[] = [];
  const KVprefix = ["todo-list"];
  switch (filter) {
    case "all": {
      break;
    }
    case "checked": {
      KVprefix.push("checked");
      break;
    }
    case "unchecked": {
      KVprefix.push("unchecked");
      break;
    }
    default:
      break;
  }
  const iter = kv.list<Todo>({ prefix: KVprefix });
  for await (const res of iter) todos.push(res.value);
  return c.json({
    code: 200,
    message: "success",
    data: todos.slice(startIndex, endIndex),
  });
});

app.get("/todo/count", async (c) => {
  const itemSize = 6;
  const iter = kv.list<Todo>({ prefix: ["todo-list"] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  const totalPage = Math.ceil(todos.length / itemSize);
  return c.json({ code: 200, message: "success", data: totalPage });
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
    ["todo-list", id, "unchecked"],
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
  const result = await kv.set([
    "todo-list",
    id,
    body.isChecked ? "checked" : "unchecked",
  ], {
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

app.delete("/todo/delete/all", async (a) => {
  const iter = kv.list<Todo>({ prefix: ["todo-list"] });
  for await (const res of iter) {
    await kv.delete(["todo-list", res.value.id]);
  }
  return a.json({ code: 200, message: "all todos deleted", data: null });
});

Deno.serve(app.fetch);
