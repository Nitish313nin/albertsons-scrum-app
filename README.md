# Albertsons Shared Scrum App

This is the shared/server version. Unlike the WhatsApp HTML-only version, data is stored centrally in SQLite on the server.

## Run
1. Install Node.js 20+.
2. In this folder run `npm install`.
3. Set `SESSION_SECRET` to a long random value.
4. Run `npm start`.
5. Open `http://localhost:3000`.

Owner:
- Email: nitishkumar.nin@gmail.com
- On first setup, enter your desired password and press “Set / Reset Owner Password”.
- Then use the same email + password with Login.

## Important
For two phones to share data, deploy the entire project to a public HTTPS server. Do not send only the HTML file through WhatsApp. Both phones must open the same hosted URL.

The server provides:
- central database
- authentication
- owner/developer permissions
- shared tasks and assignment
- shared comments
- shared audit trail
- realtime refresh through Socket.IO

For enterprise production, use Microsoft Entra ID + Azure App Service + Azure SQL/PostgreSQL and server-side authorization.
