import { Router } from "express";
import { SpecialtyController } from "./specialty.controller";


const router = Router()


router.get('/', SpecialtyController.getAllSpecialties)
router.post('/', 
    // multerUpload.single('file'),
    // validateRequest(SpecialtyValidation.createSpecialtyZodSchema),
    SpecialtyController.createSpecialty
)
router.patch('/:id', SpecialtyController.updateSpecialty)

router.delete('/:id', 
    // checkAuth(Role.ADMIN, Role.SUPER_ADMIN),
    SpecialtyController.deleteSpecialty
)


export const SpecialtyRoutes = router