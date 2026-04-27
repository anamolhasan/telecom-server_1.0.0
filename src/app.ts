import express, { Application } from 'express'
import cors from 'cors'
import { envVars } from './app/config/env'
import { toNodeHandler } from 'better-auth/node';
import { auth } from './app/lib/auth';
import cookieParser from 'cookie-parser'
import { IndexRouters } from './app/routes';

const app: Application = express()


app.use(cors({
    origin:[
        envVars.FRONTEND_URL,
        envVars.BETTER_AUTH_URL,
        "http://localhost:3000",
        "http://localhost:5000"
    ],
    credentials:true,
    methods:['GET','POST','PUT','DELETE','PATCH'],
    allowedHeaders:['Content-Type','Authorization']
}))

app.use('/api/auth', toNodeHandler(auth))

// Enable URL-encoded form data parsing
app.use(express.urlencoded({extended:true}));

// Middleware to parse JSON bodies
app.use(express.json())
app.use(cookieParser())
app.use(express.urlencoded({extended:true}))

app.use('/api/v1/', IndexRouters)

// Basic route
app.get('/', (req, res) =>{
     res.send('<h1>Server is running</h1>')
})

export default app