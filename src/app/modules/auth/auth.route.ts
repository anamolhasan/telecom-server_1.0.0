import { Router } from "express";
import { authController } from "./auth.controller";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthValidation } from "./auth.validation";
import { Role } from "../../../generated/prisma/enums";


const router = Router()

router.post('/register', validateRequest(AuthValidation.registerAppUserZodSchema), authController.registerAppUser)
router.post('/login', validateRequest(AuthValidation.loginAppUserZodSchema), authController.loginUser)
router.get('/me', checkAuth(Role.SUPER_ADMIN, Role.ADMIN, Role.SUPPORT, Role.STAFF, Role.USER, Role.AGENT), authController.getMe)


export const AuthRoutes = router;
