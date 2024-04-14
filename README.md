# <img src="https://github.com/Virtuso1225/Todo-Deno-Server/assets/75214259/7f605320-8cb2-4080-ae16-d3625692b550" widt="100" height="100"> Deno + Deno Kv

### GET TODO
```ts
app.get("/todo")
```
response:
```ts
{
  code: 200,
  message: "success",
  data: todos
}
```

### POST TODO
```ts
app.post("/todo/create")
```

response: in success case
```ts
{
  code: 200,
  message: "todo creation success",
  data: result
}

result: Deno.KvCommitResult
```

### PATCH TODO
```ts
app.patch("/todo/update/:id")
```

response: in success case
```ts
{
  code: 200,
  message: "todo update success",
  data: result
}

result : Deno.KvCommitResult
```

### DELETE TODO
```ts
app.delete("/todo/delete/:id")
```

response: in success case
```ts
{
  code: 200,
  message: "todo delete success",
  data: null
}
```
