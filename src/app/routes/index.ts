import { Router } from "express";
import { AgentApplicationRoutes } from "../modules/agentApplication/agentApplication.route";
import { AuthRoutes } from "../modules/auth/auth.route";
import { OperatorRoutes } from "../modules/operator/operator.route";
import { OrderRoutes } from "../modules/order/order.route";
import { ProductRoutes } from "../modules/product/product.route";
import { ReferralRoutes } from "../modules/referral/referral.route";
import { SpecialtyRoutes } from "../modules/specialty/specialty.route";
import { UserRoutes } from "../modules/user/user.route";
import { WalletRoutes } from "../modules/wallet/wallet.route";
import { WithdrawalRoutes } from "../modules/withdrawal/withdrawal.route";


const router = Router()

router.use('/auth', AuthRoutes)
router.use('/agent-applications', AgentApplicationRoutes)
router.use('/specialties', SpecialtyRoutes)
router.use('/operators', OperatorRoutes)
router.use('/products', ProductRoutes)
router.use('/orders', OrderRoutes)
router.use('/referral', ReferralRoutes)
router.use('/users', UserRoutes)
router.use('/wallet', WalletRoutes)
router.use('/withdrawals', WithdrawalRoutes)


export const IndexRouters = router
