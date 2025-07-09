const express = require('express');
const mysql = require('mysql2');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const path = require('path');
const app = express();
const PORT = 3000;

dotenv.config(); // Load environment variables

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // For index.html

// MySQL connection
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

db.connect(err => {
    if (err) throw err;
    console.log('✅ MySQL connected');
});

// Middleware for token-based auth
function authenticate(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, 'secret', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function authorizeRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role) return res.sendStatus(403);
        next();
    };
}

// User Registration
app.post('/register', async (req, res) => {
    const { username, password, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    db.query(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        [username, hashedPassword, role || 'customer'],
        (err) => {
            if (err) return res.status(500).send(err);
            res.send('User registered');
        }
    );
});

// Login
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.query('SELECT * FROM users WHERE username = ?', [username], async (err, results) => {
        if (err || results.length === 0) return res.status(401).send('Invalid credentials');
        const user = results[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).send('Invalid credentials');
        const token = jwt.sign({ id: user.id, role: user.role }, 'secret');
        res.json({ token });
    });
});

// ✅ FIXED: Product fetch (no image field)
app.get('/products', (req, res) => {
    const query = `SELECT id, title, description, price FROM products`;
    db.query(query, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// ✅ FIXED: Field names for insert/update
app.post('/products', authenticate, authorizeRole('admin'), (req, res) => {
    const { title, description, price } = req.body;
    db.query(
        'INSERT INTO products (title, description, price) VALUES (?, ?, ?)',
        [title, description, price],
        (err) => {
            if (err) return res.status(500).send(err);
            res.send('Product added');
        }
    );
});

app.put('/products/:id', authenticate, authorizeRole('admin'), (req, res) => {
    const { title, description, price } = req.body;
    db.query(
        'UPDATE products SET title = ?, description = ?, price = ? WHERE id = ?',
        [title, description, price, req.params.id],
        (err) => {
            if (err) return res.status(500).send(err);
            res.send('Product updated');
        }
    );
});

app.delete('/products/:id', authenticate, authorizeRole('admin'), (req, res) => {
    db.query('DELETE FROM products WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send('Product deleted');
    });
});

// Cart
app.post('/cart', authenticate, (req, res) => {
    const { productId, quantity } = req.body;
    db.query(
        'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
        [req.user.id, productId, quantity],
        (err) => {
            if (err) return res.status(500).send(err);
            res.send('Item added to cart');
        }
    );
});

app.get('/cart', authenticate, (req, res) => {
    db.query('SELECT * FROM cart WHERE user_id = ?', [req.user.id], (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.put('/cart', authenticate, (req, res) => {
    const items = req.body.items;
    db.query('DELETE FROM cart WHERE user_id = ?', [req.user.id], (err) => {
        if (err) return res.status(500).send(err);
        const values = items.map(item => [req.user.id, item.productId, item.quantity]);
        if (!values.length) return res.send('Cart updated');
        db.query('INSERT INTO cart (user_id, product_id, quantity) VALUES ?', [values], (err) => {
            if (err) return res.status(500).send(err);
            res.send('Cart updated');
        });
    });
});

app.delete('/cart', authenticate, (req, res) => {
    db.query('DELETE FROM cart WHERE user_id = ?', [req.user.id], (err) => {
        if (err) return res.status(500).send(err);
        res.send('Cart cleared');
    });
});

// Orders
app.post('/order', authenticate, (req, res) => {
    db.query('SELECT * FROM cart WHERE user_id = ?', [req.user.id], (err, cartItems) => {
        if (err || cartItems.length === 0) return res.status(400).send('Cart is empty');
        const orderItems = cartItems.map(item => ({
            user_id: item.user_id,
            product_id: item.product_id,
            quantity: item.quantity
        }));

        db.query('INSERT INTO orders (user_id, created_at) VALUES (?, NOW())', [req.user.id], (err, result) => {
            if (err) return res.status(500).send(err);
            const orderId = result.insertId;
            const values = orderItems.map(item => [orderId, item.product_id, item.quantity]);
            db.query('INSERT INTO order_items (order_id, product_id, quantity) VALUES ?', [values], (err) => {
                if (err) return res.status(500).send(err);
                db.query('DELETE FROM cart WHERE user_id = ?', [req.user.id], () => {
                    res.send('Order placed');
                });
            });
        });
    });
});

// Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
