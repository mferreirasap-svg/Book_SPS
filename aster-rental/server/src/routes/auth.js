// Login, logout e dados do usuário logado.
export default async function authRoutes(app, { deps }) {
  const { auth, cfg } = deps;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'strict', secure: cfg.session.secure, maxAge: cfg.session.maxHours * 3600 };

  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { body: { type: 'object', required: ['login', 'password'], properties: { login: { type: 'string', maxLength: 60 }, password: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const { token, user } = auth.login(req.body.login, req.body.password, { ip: req.ip, userAgent: req.headers['user-agent'] });
    reply.setCookie(cfg.session.cookieName, token, cookieOpts);
    deps.audit.record({ ...req, user }, { action: 'login', entity: 'usuario', id: user.login });
    return { user, b1Mode: cfg.b1.mode };
  });

  app.post('/auth/logout', async (req, reply) => {
    auth.logout(req.cookies[cfg.session.cookieName]);
    reply.clearCookie(cfg.session.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => ({ user: req.user, b1Mode: cfg.b1.mode }));
}
