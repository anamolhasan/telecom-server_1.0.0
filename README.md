- express
- -D @types/node @types/express
- --save-dev eslint @eslint/js typescript typescript-eslint
- dotenv
- ts config
- eslint.config.mjs    root folder a add korte hobe
- prisma
- create auth.prisma
- prisma cli
```bash 
pnpm dlx auth@latest generate --output ./prisma/schema/auth.prisma --config ./src/app/lib/auth.ts
```


# 🧠 কেন এটা better?
## 🔐 SUPER_ADMIN
- full control (system owner)
## 🛠️ ADMIN
- business manage
## 🎧 SUPPORT (MODERATOR replace)
- user help, ticket solve
## 👨‍💼 STAFF (EMPLOYEE replace)
- limited internal work (order, data entry)
## 👤 USER
- buy only
## 💰 AGENT
- sell + commission earn