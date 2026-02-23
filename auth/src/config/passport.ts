import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pool from './database';
import { v4 as uuidv4 } from 'uuid';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback';

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;
        const googleId = profile.id;
        const avatarUrl = profile.photos?.[0]?.value;

        if (!email) {
          return done(new Error('No email found in Google profile'));
        }

        // Check if user exists
        let userResult = await pool.query(
          'SELECT id, email, full_name, cognito_sub FROM users WHERE email = $1',
          [email.toLowerCase()]
        );

        let user;

        if (userResult.rows.length === 0) {
          // Create new user
          const userId = uuidv4();
          const cognitoSub = `google_${googleId}`;

          await pool.query(
            `INSERT INTO users (id, cognito_sub, email, email_verified, full_name, avatar_url, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, cognitoSub, email.toLowerCase(), true, name, avatarUrl, 'active']
          );

          user = {
            id: userId,
            email: email.toLowerCase(),
            full_name: name,
            cognito_sub: cognitoSub,
          };
        } else {
          user = userResult.rows[0];

          // Update last login
          await pool.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [user.id]
          );
        }

        return done(null, user);
      } catch (error) {
        return done(error as Error);
      }
    }
  )
);

// Serialize user to session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id: string, done) => {
  try {
    const result = await pool.query(
      'SELECT id, email, full_name FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return done(new Error('User not found'));
    }

    done(null, result.rows[0]);
  } catch (error) {
    done(error);
  }
});

export default passport;