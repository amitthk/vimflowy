import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';

import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import minimist from 'minimist';
import dotenv from 'dotenv';

import logger from '../src/shared/utils/logger';

import makeSocketServer from './socket_server';
import { defaultBuildDir } from './constants';

// Load environment variables
dotenv.config();

async function main(args: any) {
  if (args.help || args.h) {
    process.stdout.write(`
      Usage: ./node_modules/.bin/ts-node ${process.argv[1]}
          -h, --help: help menu

          --host $hostname: Host to listen on
          --port $portnumber: Port to run on

          --db $dbtype: Database type (use 'postgres' for PostgreSQL)
          --dbConnectionString: PostgreSQL connection string
            Example: postgresql://user:password@localhost:5432/vimflowy

          --googleClientId: Google OAuth2 Client ID
          --googleClientSecret: Google OAuth2 Client Secret
          --sessionSecret: Secret for session encryption

          --buildDir: Where build assets should be served from.  Defaults to the \`build\`
            folder at the repo root.

    `, () => {
      process.exit(0);
    });
    return;
  }

  const buildDir = path.resolve(args.buildDir || defaultBuildDir);

  let port: number = args.port || 3000;
  let host: string = args.host || 'localhost';

  if (!fs.existsSync(buildDir)) {
    logger.info(`
        No assets found at ${buildDir}!
        Try running \`npm run build -- --outdir ${buildDir}\` first.
        Or specify where they should be found with --buildDir $somedir.
    `);
    return;
  }

  const googleClientId = args.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = args.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  const sessionSecret = args.sessionSecret || process.env.SESSION_SECRET || 'your-secret-key-change-in-production';
  const dbConnectionString = args.dbConnectionString || process.env.DATABASE_URL;

  if (!googleClientId || !googleClientSecret) {
    logger.error('Google OAuth2 credentials are required! Set --googleClientId and --googleClientSecret');
    process.exit(1);
  }

  logger.info('Starting production server');
  const app = express();

  // Session configuration
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' }
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // Passport configuration
  passport.use(new GoogleStrategy({
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: `http://${host}:${port}/auth/google/callback`
    },
    (accessToken, refreshToken, profile, done) => {
      // Store user profile
      const user = {
        id: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName
      };
      return done(null, user);
    }
  ));

  passport.serializeUser((user: any, done) => {
    done(null, user);
  });

  passport.deserializeUser((user: any, done) => {
    done(null, user);
  });

  // Auth routes
  app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
  );

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    (req, res) => {
      res.redirect('/');
    }
  );

  app.get('/auth/logout', (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });

  app.get('/auth/user', (req, res) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });

  // Serve static files
  app.use(express.static(buildDir));

  const server = http.createServer(app as any);
  
  if (args.db) {
    const options = {
      db: args.db,
      dbConnectionString: dbConnectionString,
      path: '/socket',
    };
    makeSocketServer(server, options);
  }

  server.listen(port, host, (err?: Error) => {
    if (err) { return logger.error(err); }
    const address_info: AddressInfo = server.address() as AddressInfo;
    logger.info('Listening on http://%s:%d', address_info.address, address_info.port);
  });
}

main(minimist(process.argv.slice(2)));
