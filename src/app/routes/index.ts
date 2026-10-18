import { Router } from "express";
import { AgentRoutes } from "../modules/earningPrograms/agent/agent/agent.route";
import { AgentApplicationRoutes } from "../modules/earningPrograms/agent/agentApplication/agentApplication.route";
import { AffiliateRoutes } from "../modules/earningPrograms/affiliate/affiliate/affiliate.route";
import { AffiliateApplicationRoutes } from "../modules/earningPrograms/affiliate/affiliateApplication/affiliateApplication.route";
import { AuthRoutes } from "../modules/auth/auth.route";
import { BrandRoutes } from "../modules/ecommerce/brand/brand.route";
import { CartRoutes } from "../modules/ecommerce/cart/cart.route";
import { CategoryRoutes } from "../modules/ecommerce/category/category.route";
import { EarningRoutes } from "../modules/earning/earning.route";
import { InventoryRoutes } from "../modules/ecommerce/inventory/inventory.route";
import { ProductRoutes } from "../modules/ecommerce/product/product.route";
import { ProductOrderRoutes } from "../modules/ecommerce/productOrder/productOrder.route";
import { ProductVariantRoutes } from "../modules/ecommerce/productVariant/productVariant.route";
import { OperatorRoutes } from "../modules/telecom/operator/operator.route";
import { OrderRoutes } from "../modules/telecom/operatorOrder/order.route";
import { OperatorOfferRoutes } from "../modules/telecom/operatorOffer/operatorOffer.route";
import { ReferralRoutes } from "../modules/earningPrograms/referral/referral.route";
import { RoleAccessRoutes } from "../modules/roleAccess/roleAccess.route";
import { SettingRoutes } from "../modules/setting/setting.route";
import { UploadRoutes } from "../modules/upload/upload.route";
import { UserRoutes } from "../modules/user/user.route";
import { WalletRoutes } from "../modules/wallet/wallet.route";
import { WithdrawalRoutes } from "../modules/withdrawal/withdrawal.route";


const router = Router()

router.use('/auth', AuthRoutes)
router.use('/agent-applications', AgentApplicationRoutes)
router.use('/affiliate-applications', AffiliateApplicationRoutes)
router.use('/uploads', UploadRoutes)
// E-commerce catalog, inventory and cart (Phase 1: no checkout/orders/payment).
router.use('/categories', CategoryRoutes)
router.use('/brands', BrandRoutes)
router.use('/products', ProductRoutes)
router.use('/product-variants', ProductVariantRoutes)
router.use('/inventory', InventoryRoutes)
router.use('/cart', CartRoutes)
// E-commerce checkout + ProductOrder (Phase 2A: Cash on Delivery only). Mounted
// on its own path so no existing Telecom route changes.
router.use('/product-orders', ProductOrderRoutes)
router.use('/operators', OperatorRoutes)
router.use('/operator-offers', OperatorOfferRoutes)
router.use('/orders', OrderRoutes)
router.use('/referral', ReferralRoutes)
// Shared earning foundation for the Agent / Referral / Affiliate income programs.
router.use('/earnings', EarningRoutes)
// Agent program: dashboard, own sales and own earnings. The application review
// flow keeps its own path above.
router.use('/agent', AgentRoutes)
// Affiliate program: permanent links, first-touch attribution, conversions and
// own earnings. The application review flow keeps its own path.
router.use('/affiliate', AffiliateRoutes)
router.use('/settings', SettingRoutes)
router.use('/role-access', RoleAccessRoutes)
router.use('/users', UserRoutes)
router.use('/wallet', WalletRoutes)
router.use('/withdrawals', WithdrawalRoutes)


export const IndexRouters = router
