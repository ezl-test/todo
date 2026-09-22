require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { query } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.accepts("html")) return res.redirect("/login");
    return res.status(401).json({ error: "Authentication required." });
  }
  next();
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

app.get("/signup", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("signup", { error: null, username: "" });
});

app.post("/signup", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!USERNAME_RE.test(username)) {
      return res.status(400).render("signup", {
        error: "Username must be 3–32 characters: letters, numbers, underscore.",
        username,
      });
    }
    if (password.length < 6) {
      return res.status(400).render("signup", {
        error: "Password must be at least 6 characters.",
        username,
      });
    }

    const { rows: existing } = await query(
      "SELECT 1 FROM users WHERE username = $1",
      [username],
    );
    if (existing.length) {
      return res.status(409).render("signup", {
        error: `The username "${username}" is already registered.`,
        username,
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [username, passwordHash],
    );

    req.session.user = { id: rows[0].id, username: rows[0].username };
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null, username: "" });
});

app.post("/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const { rows } = await query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username],
    );
    const user = rows[0];

    if (!user) {
      return res.status(401).render("login", {
        error: `No account found for "${username}".`,
        username,
      });
    }

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).render("login", {
        error: "Incorrect password. Please try again.",
        username,
      });
    }

    req.session.user = { id: user.id, username: user.username };
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows: todos } = await query(
      "SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.user.id],
    );
    res.render("index", { todos });
  } catch (err) {
    next(err);
  }
});

app.post("/todos", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    if (title) {
      await query("INSERT INTO todos (user_id, title) VALUES ($1, $2)", [
        req.session.user.id,
        title,
      ]);
    }
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/todos/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE todos SET is_done = NOT is_done, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.session.user.id],
    );
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/todos/:id/edit", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    if (title) {
      await query(
        "UPDATE todos SET title = $1, updated_at = now() WHERE id = $2 AND user_id = $3",
        [title, req.params.id, req.session.user.id],
      );
    }
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.post("/todos/:id/delete", requireAuth, async (req, res, next) => {
  try {
    await query("DELETE FROM todos WHERE id = $1 AND user_id = $2", [
      req.params.id,
      req.session.user.id,
    ]);
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

app.get("/api/todos", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM todos WHERE user_id = $1 ORDER BY created_at DESC",
      [req.session.user.id],
    );
    res.json({ user: req.session.user.username, todos: rows });
  } catch (err) {
    next(err);
  }
});

app.get("/api/todos/search", requireAuth, async (req, res, next) => {
  try {
    const q = req.query.q || "";
    const sql =
      "SELECT * FROM todos WHERE user_id = " +
      req.session.user.id +
      " AND title ILIKE '%" +
      q +
      "%' ORDER BY created_at DESC";
    const { rows } = await query(sql);
    res.json({ user: req.session.user.username, todos: rows });
  } catch (err) {
    next(err);
  }
});

app.get("/api/todos/:id", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM todos WHERE id = $1", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Todo not found." });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.post("/api/todos", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim();
    if (!title) {
      return res.status(400).json({ error: "A 'title' string is required." });
    }
    const { rows } = await query(
      "INSERT INTO todos (user_id, title) VALUES ($1, $2) RETURNING *",
      [req.session.user.id, title],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.put("/api/todos/:id", requireAuth, async (req, res, next) => {
  try {
    const columns = Object.keys(req.body);
    if (columns.length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }

    const assignments = columns.map((col, i) => `${col} = $${i + 1}`);
    const values = columns.map((col) => req.body[col]);
    values.push(req.params.id);

    const sql = `UPDATE todos SET ${assignments.join(", ")}, updated_at = now()
                 WHERE id = $${values.length} RETURNING *`;
    const { rows } = await query(sql, values);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Todo not found." });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/todos/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM todos WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.user.id],
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: "Todo not found." });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

app.get("/api/users/:username", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM users WHERE username = $1", [
      req.params.username,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`To-do app listening on http://localhost:${PORT}`);
});
