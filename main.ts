import { Hono } from "https://deno.land/x/hono@v4.2.3/mod.ts";
import { cors } from "https://deno.land/x/hono@v4.2.3/middleware.ts";
import { ulid } from "https://deno.land/x/ulid@v0.3.0/mod.ts";
import { load } from "https://deno.land/std@0.222.1/dotenv/mod.ts";

const app = new Hono();
const kv = await Deno.openKv();
const env = await load();
app.use(
  "/*",
  cors({
    origin: env["CORS_ORIGIN"] || "http://localhost:5173",
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

app.get("/todo", async (c) => {
  const iter = kv.list<Todo>({ prefix: ["todo-list"] });
  const todos: Todo[] = [];
  for await (const res of iter) todos.push(res.value);
  return c.json({ code: 200, message: "success", data: todos });
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

Deno.serve({ port: 8000 }, app.fetch);
