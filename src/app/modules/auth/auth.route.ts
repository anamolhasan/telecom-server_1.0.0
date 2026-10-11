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
router.patch('/me', checkAuth(...ALL_ROLES), validateRequest(AuthValidation.updateProfileZodSchema), authController.updateMe)
router.post('/change-password', checkAuth(...ALL_ROLES), validateRequest(AuthValidation.changePasswordZodSchema), authController.changePassword)
router.post('/refresh', authController.refreshTokens)
router.post('/logout', authController.logout)


export const AuthRoutes = router;
