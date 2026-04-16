# Super Admin Creation Script

This script creates or updates a Super Admin user in the Spotipr multi-tenant SaaS platform.

## Features

- ✅ Creates a new Super Admin user if none exists
- ✅ Updates existing Super Admin credentials if one exists
- ✅ Secure password hashing with bcrypt
- ✅ Can be run multiple times safely
- ✅ Customizable credentials via command line arguments

## Usage

### Basic Usage (Default Credentials)

```bash
# Using npm script (recommended)
npm run create-admin

# Or directly with node
node scripts/create-super-admin.js

# Or on Windows with batch file
scripts\create-admin.bat
```

Creates Super Admin with default credentials:
- **Email**: `superadmin@spotipr.com`
- **Password**: `SuperSecure123!`
- **Name**: `Super Admin`

### Custom Credentials

```bash
npm run create-admin your-email@company.com YourPassword123 "Your Name"
# or
node scripts/create-super-admin.js your-email@company.com YourPassword123 "Your Name"
```

### Command Line Arguments

```bash
node scripts/create-super-admin.js [email] [password] [name]
```

- `email` (optional): Super Admin email address
- `password` (optional): Super Admin password (min 8 characters recommended)
- `name` (optional): Super Admin display name

## Examples

```bash
# Create with custom email
npm run create-admin admin@mycompany.com

# Create with custom email and password
npm run create-admin admin@mycompany.com MySecurePass123

# Create with all custom fields
npm run create-admin admin@mycompany.com MySecurePass123 "John Administrator"
```

## Output

The script will display:
- ✅ Confirmation of creation/update
- 🔑 Login credentials
- 📋 Next steps for testing

Example output:
```
🚀 Creating Super Admin User...
📧 Email: admin@mycompany.com
👤 Name: John Administrator
🔒 Password: [HIDDEN]

📝 Super Admin already exists, updating...
✅ Super Admin updated successfully!

🎯 Super Admin Details:
ID: cmg0owgqr00005rrw1zewlh4u
Email: admin@mycompany.com
Name: John Administrator
Role: SUPER_ADMIN
Status: ACTIVE

🔑 Login Credentials:
Email: admin@mycompany.com
Password: MySecurePass123

💡 Use these credentials to login and manage your platform!
```

## What the Super Admin Can Do

Once created, the Super Admin can:

1. **Login** to the platform at `/login`
2. **Create tenants** (companies) via the Super Admin dashboard
3. **Generate ATI tokens** for tenant onboarding
4. **Monitor platform statistics** and tenant activity
5. **Manage the entire multi-tenant ecosystem**

## Security Notes

- Passwords are hashed using bcrypt with 12 salt rounds
- The script can be run multiple times to update credentials
- Only one Super Admin can exist in the system
- All Super Admin actions are logged in the audit trail

## Troubleshooting

### "Cannot find module" errors
Make sure dependencies are installed:
```bash
npm install
```

### Database connection issues
Ensure your database is running and the connection string in `.env.local` is correct.

### Permission errors
Make sure you have write permissions to the database.

## Next Steps

After creating the Super Admin:

1. Start the development server: `npm run dev`
2. Login at `http://localhost:3000/login`
3. Access the Super Admin dashboard
4. Create tenants and generate ATI tokens
5. Test the multi-tenant user onboarding flow

---

**Happy testing! 🚀**
