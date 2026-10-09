import { Router } from "express";
import { authController } from "./auth.controller";
import { checkAuth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthValidation } from "./auth.validation";
import { ALL_ROLES } from "../../constants/rbac.constant";


const router = Router()

router.post('/register', validateRequest(AuthValidation.registerAppUserZodSchema), authController.registerAppUser)
router.post('/login', validateRequest(AuthValidation.loginAppUserZodSchema), authController.loginUser)
router.get('/me', checkAuth(...ALL_ROLES), authController.getMe)


export const AuthRoutes = router;
