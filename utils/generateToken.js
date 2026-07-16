import jwt from 'jsonwebtoken';

const generateToken = (res, userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET || 'secret123', {
    expiresIn: '30d',
  });

  const isProduction = process.env.NODE_ENV === 'production';

  res.cookie('jwt', token, {
    httpOnly: true,
    secure: isProduction,           // HTTPS-only in production
    sameSite: isProduction ? 'none' : 'lax', // cross-site in production (required for Render + Vercel)
    path: '/',                      // ensure cookie applies to all routes
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  });
};

export default generateToken;
