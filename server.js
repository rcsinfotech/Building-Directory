const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const httpsPort = 8443;
const https = require('https');
const app = express();
const port = 8080;
const crypto = require('crypto');
const multer = require('multer');

// Per-device login secret. Generated once and kept in data/ (not in git), so a
// token from one sign or from the source code can't be used to log in anywhere.
const JWT_SECRET_FILE = path.join(__dirname, 'data', '.jwt-secret');
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const existing = fs.readFileSync(JWT_SECRET_FILE, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (e) { /* not created yet */ }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(JWT_SECRET_FILE), { recursive: true });
  fs.writeFileSync(JWT_SECRET_FILE, secret + '\n', { mode: 0o600 });
  return secret;
}
const JWT_SECRET = loadJwtSecret();

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Data files
const DIRECTORY_FILE = path.join(__dirname, 'data', 'directory.json');
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');

// Helper functions
function readDirectoryData() {
  try {
    const data = fs.readFileSync(DIRECTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading directory data:', error);

return {
  settings: {
    buildingName: "Building Directory",
    welcomeMessage: "Welcome to Our Building",
    showInfoSection: false,
    colors: {
      headerBackground: "#1a5276",
      headerText: "#ffffff",
      directoryBackground: "#f5f5f5",
      directoryText: "#333333",
      tenantBackground: "#ffffff",
      infoBackground: "#f0f7fc",
      infoText: "#333333",
      footerBackground: "#1a5276",
      footerText: "#ffffff"
    }
  },
  tenants: [],
  infoSection: {
    title: "",
    content: ""
  },
  lastUpdated: new Date().toISOString()
};
  }
}

function saveDirectoryData(data) {
  try {
    // Add or update the lastUpdated timestamp
    data.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(DIRECTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving directory data:', error);
    return false;
  }
}

// Authentication middleware
function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  
  if (!token) return res.redirect('/admin/login');

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.redirect('/admin/login');
    req.user = user;
    next();
  });
}

// Add this function after the existing authentication middleware
function redirectToHttps(req, res, next) {
  // Skip redirect for local development or if already using HTTPS
  if (req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'development') {
    return next();
  }
  
  // Redirect to HTTPS
  const httpsUrl = `https://${req.headers.host.split(':')[0]}:${httpsPort}${req.url}`;
  res.redirect(httpsUrl);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create images directory if it doesn't exist
    const dir = path.join(__dirname, 'public', 'images');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Use building-image.jpg for the building image to always overwrite the previous one
    if (file.fieldname === 'buildingImage') {
      cb(null, 'building-image.jpg');
    } else {
      // For any other images, use timestamp + original name
      cb(null, Date.now() + '-' + file.originalname);
    }
  }
});

// File filter to only accept images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Not an image! Please upload an image.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Handle uploaded images
app.post('/admin/upload-image', authenticateToken, upload.single('buildingImage'), (req, res) => {
  try {
    if (!req.file) {
      return res.redirect('/admin?message=No+image+selected');
    }
    
    // Update the data to indicate we have an image
    const data = readDirectoryData();
    data.settings.hasBuildingImage = true;
    saveDirectoryData(data);
    
    res.redirect('/admin?message=Image+uploaded+successfully');
  } catch (error) {
    console.error('Image upload error:', error);
    res.redirect('/admin?message=Error+uploading+image');
  }
});


// Routes for public display
app.get('/', (req, res) => {
  const data = readDirectoryData();
  res.render('display', { 
    title: data.settings.buildingName,
    message: data.settings.welcomeMessage,
    tenants: data.tenants,
    showInfo: data.settings.showInfoSection,
    infoSection: data.infoSection,
    data: data, // Add this line to pass the entire data object
    // Optional per-sign style overrides (public/css/site.css, not in git)
    hasSiteCss: fs.existsSync(path.join(__dirname, 'public', 'css', 'site.css'))
  });
});

// Admin login routes
app.get('/admin/login', redirectToHttps, (req, res) => {
  res.render('admin-login', { error: null });
});

// Passwords are stored as bcrypt hashes. Older admin.json files hold the
// password in plain text; those still work and are converted to a hash the
// first time someone logs in successfully.
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);
}

function checkPassword(candidate, stored) {
  if (typeof candidate !== 'string' || typeof stored !== 'string') return false;
  if (isBcryptHash(stored)) return bcrypt.compareSync(candidate, stored);
  const a = Buffer.from(candidate), b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function saveAdminData(adminData) {
  fs.writeFileSync(ADMIN_FILE, JSON.stringify(adminData, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(ADMIN_FILE, 0o600); } catch (e) { /* best effort */ }
}

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  try {
    const adminData = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));

    if (username !== adminData.username || !checkPassword(password, adminData.password)) {
      return res.render('admin-login', { error: 'Invalid credentials' });
    }

    // Upgrade a legacy plain-text password to a hash
    if (!isBcryptHash(adminData.password)) {
      adminData.password = bcrypt.hashSync(password, 10);
      saveAdminData(adminData);
    }

    // Create token
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '2h' });

    // Set cookie and redirect
    res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 7200000 }); // 2 hours
    res.redirect('/admin');
    
  } catch (error) {
    console.error('Login error:', error);
    res.render('admin-login', { error: 'Error processing login' });
  }
});

// Admin logout
app.get('/admin/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/admin/login');
});

// Admin routes (protected)
app.get('/admin', redirectToHttps, authenticateToken, (req, res) => {
  const data = readDirectoryData();
  res.render('admin', { 
    data: data,
    message: req.query.message || null,
    query: req.query
  });
});

// Update settings
app.post('/admin/settings', authenticateToken, (req, res) => {
  const { buildingName, welcomeMessage, showInfoSection } = req.body;
  const data = readDirectoryData();
  
  data.settings.buildingName = buildingName;
  data.settings.welcomeMessage = welcomeMessage;
  data.settings.showInfoSection = showInfoSection === 'on';
  
  if (saveDirectoryData(data)) {
    res.redirect('/admin?message=Settings+updated+successfully');
  } else {
    res.redirect('/admin?message=Error+saving+settings');
  }
});

// Update info section
app.post('/admin/info', authenticateToken, (req, res) => {
  const { infoTitle, infoContent } = req.body;
  const data = readDirectoryData();
  
  data.infoSection.title = infoTitle;
  data.infoSection.content = infoContent;
  
  if (saveDirectoryData(data)) {
    res.redirect('/admin?message=Info+section+updated+successfully');
  } else {
    res.redirect('/admin?message=Error+saving+info+section');
  }
});

// Add tenant
app.post('/admin/tenant/add', authenticateToken, (req, res) => {
  const { suite, name } = req.body;
  const data = readDirectoryData();
  
  // Create a new tenant with unique ID
  const newId = Date.now().toString();
  data.tenants.push({
    id: newId,
    suite: suite,
    name: name
  });
  
  // Sort tenants by suite number
  data.tenants.sort((a, b) => {
    return a.suite.localeCompare(b.suite, undefined, { numeric: true });
  });
  
  if (saveDirectoryData(data)) {
    res.redirect('/admin?message=Tenant+added+successfully');
  } else {
    res.redirect('/admin?message=Error+adding+tenant');
  }
});

// Edit tenant
app.post('/admin/tenant/edit', authenticateToken, (req, res) => {
  const { id, suite, name } = req.body;
  const data = readDirectoryData();
  
  const tenantIndex = data.tenants.findIndex(t => t.id === id);
  if (tenantIndex !== -1) {
    data.tenants[tenantIndex].suite = suite;
    data.tenants[tenantIndex].name = name;
    
    // Resort tenants
    data.tenants.sort((a, b) => {
      return a.suite.localeCompare(b.suite, undefined, { numeric: true });
    });
    
    if (saveDirectoryData(data)) {
      res.redirect('/admin?message=Tenant+updated+successfully');
    } else {
      res.redirect('/admin?message=Error+updating+tenant');
    }
  } else {
    res.redirect('/admin?message=Tenant+not+found');
  }
});

// Delete tenant
app.post('/admin/tenant/delete', authenticateToken, (req, res) => {
  const { id } = req.body;
  const data = readDirectoryData();
  
  const tenantIndex = data.tenants.findIndex(t => t.id === id);
  if (tenantIndex !== -1) {
    data.tenants.splice(tenantIndex, 1);
    
    if (saveDirectoryData(data)) {
      res.redirect('/admin?message=Tenant+removed+successfully');
    } else {
      res.redirect('/admin?message=Error+removing+tenant');
    }
  } else {
    res.redirect('/admin?message=Tenant+not+found');
  }
});

// Update color settings
app.post('/admin/colors', authenticateToken, (req, res) => {
  const data = readDirectoryData();
  
  // Ensure colors object exists
  if (!data.settings.colors) {
    data.settings.colors = {};
  }
  
  // Update color settings
  data.settings.colors.headerBackground = req.body.headerBackground;
  data.settings.colors.headerText = req.body.headerText;
  data.settings.colors.directoryBackground = req.body.directoryBackground;
  data.settings.colors.directoryText = req.body.directoryText;
  data.settings.colors.tenantBackground = req.body.tenantBackground;
  data.settings.colors.infoBackground = req.body.infoBackground;
  data.settings.colors.infoText = req.body.infoText;
  data.settings.colors.footerBackground = req.body.footerBackground;
  data.settings.colors.footerText = req.body.footerText;
  
  if (saveDirectoryData(data)) {
    res.redirect('/admin?message=Color+settings+updated+successfully');
  } else {
    res.redirect('/admin?message=Error+saving+color+settings');
  }
});


// Change admin password
app.post('/admin/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  
  if (newPassword !== confirmPassword) {
    return res.redirect('/admin?message=New+passwords+do+not+match');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.redirect('/admin?message=New+password+must+be+at+least+8+characters');
  }

  try {
    const adminData = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));

    // Verify current password (hashed or legacy plain text)
    if (!checkPassword(currentPassword, adminData.password)) {
      return res.redirect('/admin?message=Current+password+is+incorrect');
    }

    // Update password
    adminData.password = bcrypt.hashSync(newPassword, 10);
    saveAdminData(adminData);
    
    res.redirect('/admin?message=Password+changed+successfully');
  } catch (error) {
    console.error('Password change error:', error);
    res.redirect('/admin?message=Error+changing+password');
  }
});

// Start HTTP server (for public display)
app.listen(port, () => {
  console.log(`Directory public display running at http://localhost:${port}`);
});

// Start HTTPS server (for admin access)
try {
  const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'certs', 'server.key')),
    cert: fs.readFileSync(path.join(__dirname, 'certs', 'server.cert'))
  };
  
  // Create HTTPS server
  https.createServer(httpsOptions, app).listen(httpsPort, () => {
    console.log(`Secure admin interface available at https://localhost:${httpsPort}/admin`);
  });
} catch (error) {
  console.error('Could not start HTTPS server:', error);
  console.log('Admin interface will only be available over HTTP');
}
