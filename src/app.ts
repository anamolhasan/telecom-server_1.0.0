import express, { Application, Request, Response } from 'express'
import cors from 'cors'
import { envVars } from './app/config/env'
import { toNodeHandler } from 'better-auth/node';
import { auth } from './app/lib/auth';
import cookieParser from 'cookie-parser'
import { IndexRouters } from './app/routes';
import { globalErrorHandler } from './app/middleware/globalErrorHandler';
import { notFound } from './app/middleware/notFound';
import { PaymentController } from './app/modules/payment/payment.controller';

const app: Application = express()

app.set('query parser', 'extended')

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

// Stripe webhook needs the raw body, so it must be registered before the JSON parser
app.post('/webhook', express.raw({ type: 'application/json' }), PaymentController.handleStripeWebhookEvent)

// Enable URL-encoded form data parsing
app.use(express.urlencoded({extended:true}));

// Middleware to parse JSON bodies
app.use(express.json())
app.use(cookieParser())
app.use(express.urlencoded({extended:true}))

app.use('/api/v1/', IndexRouters)

// Basic route
app.get('/', (req: Request, res: Response) => {
    res.send('<h1>Server is running</h1>')
})

app.use(globalErrorHandler)
app.use(notFound)

export default app
