VIMFLOWY - Mind Mapping Tool

REQUIREMENTS:
- Node.js 16+
- PostgreSQL 12+

SETUP:
1. Install dependencies:
   npm install

2. Setup PostgreSQL database:
   createdb vimflowy
   psql vimflowy < database.sql

3. Get Google OAuth2 credentials:
   - Go to Google Cloud Console (console.cloud.google.com)
   - Create a new project or select existing
   - Enable Google+ API
   - Create OAuth 2.0 credentials (Web application)
   - Add authorized redirect URI: http://localhost:3000/auth/google/callback
     (for production, use your domain: https://yourdomain.com/auth/google/callback)
   - Copy Client ID and Client Secret

4. Configure environment:
   cp .env.example .env
   Edit .env and add your Google credentials and database URL

RUN:
Development frontend: npm start
Production: npm run build && npm run startprod -- --db postgres

ENVIRONMENT:
Set these in .env file:
- DATABASE_URL: PostgreSQL connection string
- GOOGLE_CLIENT_ID: From Google Cloud Console
- GOOGLE_CLIENT_SECRET: From Google Cloud Console
- SESSION_SECRET: Random string for session encryption

TROUBLESHOOTING:
If auth doesn't work:
1. Make sure Google OAuth callback URL matches exactly:
   - In Google Console: http://localhost:3000/auth/google/callback
   - In .env: CALLBACK_URL=http://localhost:3000/auth/google/callback
2. Check browser console for errors
3. Clear browser cookies/cache
4. Verify .env file has correct credentials
5. Check server logs for authentication messages

NOTES:
- Google OAuth2 authentication required
- Each user's data is completely isolated
- Data stored in PostgreSQL database
- Firebase warning about source maps is normal and can be ignored
