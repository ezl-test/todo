const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const names = ["Alice", "Bob", "Charlie", "Diana", "Ethan"];

app.get("/", (req, res) => {
  res.send("Express server is running. Visit /names to see the list.");
});

app.get("/names", (req, res) => {
  res.json({ names });
});

app.put("/names", (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "A 'name' string is required." });
  }

  names.push(name);
  res.status(201).json({ names });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
