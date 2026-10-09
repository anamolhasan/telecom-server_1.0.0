import { Role } from "../../generated/prisma/enums";
import { envVars } from "../config/env";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";


export const seedSuperAdmin = async () => {
    try {
        const isSuperAdminExist = await prisma.user.findFirst({
            where: {
                role: Role.SUPER_ADMIN
            }
        })

        if (isSuperAdminExist) {
            console.log('Super admin already exists. Skipping seeding super admin.');
            return;
        }

        const superAdminUser = await auth.api.signUpEmail({
            body: {
                email: envVars.SUPER_ADMIN_EMAIL,
                password: envVars.SUPER_ADMIN_PASSWORD,
                name: 'Super Admin',
                role: Role.SUPER_ADMIN,
                needPasswordChange: false,
                rememberMe: false,
            }
        })

        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: {
                    id: superAdminUser.user.id
                },
                data: {
                    emailVerified: true
                }
            })

            await tx.appUser.create({
                data: {
                    authUserId: superAdminUser.user.id
                }
            })
        })

        console.log('Super admin created successfully');
    } catch (error) {
        console.log('Error seeding super admin:', error);
        await prisma.user.delete({
            where: {
                email: envVars.SUPER_ADMIN_EMAIL
            }
        })
    }
}
