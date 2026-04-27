import dotenv from "dotenv";
import status from "http-status";
import path from 'path'
import AppError from "../errorHelpers/AppError";

// dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env') });

interface EnvConfig {
  NODE_ENV: string;
  PORT: string;
  DATABASE_URL: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  ACCESS_TOKEN_SECRET: string;
  REFRESH_TOKEN_SECRET: string;
  ACCESS_TOKEN_EXPIRES_IN: string;
  REFRESH_TOKEN_EXPIRES_IN: string;
  BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: string;
  BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE: string;
  EMAIL_SENDER:{
    SMTP_USER:string;
    SMTP_PASS:string;
    SMTP_HOST:string;
    SMTP_PORT:string;
    SMTP_FROM:string;    
  }
  GOOGLE_CLIENT_ID:string;
  GOOGLE_CLIENT_SECRET:string;
  GOOGLE_CALLBACK_URL:string;
  FRONTEND_URL:string;
  CLOUDINARY:{
    CLOUDINARY_CLOUD_NAME:string;
    CLOUDINARY_API_KEY:string;
    CLOUDINARY_API_SECRET:string;
  },
  STRIPE:{
    STRIPE_SECRET_KEY:string;
    STRIPE_WEBHOOK_SECRET:string;
  },
  SUPER_ADMIN_EMAIL:string;
  SUPER_ADMIN_PASSWORD:string;
}

const loadEnvVariables = (): EnvConfig => {
  const env = process.env;

  const requireEnvVariable = [
    "NODE_ENV",
    "PORT",
    "DATABASE_URL",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRET",
    "ACCESS_TOKEN_SECRET",
    "REFRESH_TOKEN_SECRET",
    "ACCESS_TOKEN_EXPIRES_IN",
    "REFRESH_TOKEN_EXPIRES_IN",
    "BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN",
    "BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE",
    "EMAIL_SENDER_SMTP_USER",
    "EMAIL_SENDER_SMTP_PASS",
    "EMAIL_SENDER_SMTP_HOST",
    "EMAIL_SENDER_SMTP_PORT",
    "EMAIL_SENDER_SMTP_FROM",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_CALLBACK_URL",
    "FRONTEND_URL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "SUPER_ADMIN_EMAIL",
    "SUPER_ADMIN_PASSWORD"
  ];

  requireEnvVariable.forEach((variable) => {
    if (!env[variable]) {
      throw new AppError( 
        status.INTERNAL_SERVER_ERROR,
        `Environment variable ${variable} is required but not set in .env file.`,
      );
      // throw new Error(
      //   `Environment variable ${variable} is required but not set in .env file.`,
      // );
    }
  });

  return {
    NODE_ENV: env.NODE_ENV as string,
    PORT: env.PORT as string,
    DATABASE_URL: env.DATABASE_URL as string,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL as string,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET as string,
    ACCESS_TOKEN_SECRET: env.ACCESS_TOKEN_SECRET as string,
    REFRESH_TOKEN_SECRET: env.REFRESH_TOKEN_SECRET as string,
    ACCESS_TOKEN_EXPIRES_IN: env.ACCESS_TOKEN_EXPIRES_IN as string,
    REFRESH_TOKEN_EXPIRES_IN: env.REFRESH_TOKEN_EXPIRES_IN as string,
    BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN: env.BETTER_AUTH_SESSION_TOKEN_EXPIRES_IN as string,
    BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE: env.BETTER_AUTH_SESSION_TOKEN_UPDATE_AGE as string,
    EMAIL_SENDER:{
      SMTP_USER:env.EMAIL_SENDER_SMTP_USER as string,
      SMTP_PASS:env.EMAIL_SENDER_SMTP_PASS as string,
      SMTP_HOST:env.EMAIL_SENDER_SMTP_HOST as string,
      SMTP_PORT:env.EMAIL_SENDER_SMTP_PORT as string,
      SMTP_FROM:env.EMAIL_SENDER_SMTP_FROM as string,
    },
    GOOGLE_CLIENT_ID:env.GOOGLE_CLIENT_ID as string,
    GOOGLE_CLIENT_SECRET:env.GOOGLE_CLIENT_SECRET as string,
    GOOGLE_CALLBACK_URL:env.GOOGLE_CALLBACK_URL as string,
    FRONTEND_URL:env.FRONTEND_URL as string,
    CLOUDINARY:{
      CLOUDINARY_CLOUD_NAME:env.CLOUDINARY_CLOUD_NAME as string,
      CLOUDINARY_API_KEY:env.CLOUDINARY_API_KEY as string,
      CLOUDINARY_API_SECRET:env.CLOUDINARY_API_SECRET as string,
    },
    STRIPE:{
      STRIPE_SECRET_KEY:env.STRIPE_SECRET_KEY as string,
      STRIPE_WEBHOOK_SECRET:env.STRIPE_WEBHOOK_SECRET as string
    },
    SUPER_ADMIN_EMAIL:env.SUPER_ADMIN_EMAIL as string,
    SUPER_ADMIN_PASSWORD:env.SUPER_ADMIN_PASSWORD as string,
  };
};

export const envVars = loadEnvVariables()