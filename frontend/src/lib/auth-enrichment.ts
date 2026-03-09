import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fetches Organization context and flattened Permissions for a user.
 * This is the "Federated Adapter Enrichment" logic.
 */
export async function getEnrichedUserData(userId: string, organizationId?: string) {
    // Find the user's roles with permissions for the given organization
    const userOrgRoles = await prisma.userOrganizationRole.findMany({
        where: {
            userId: userId,
            organizationId: organizationId || null, // Handle Global Super Admins
        },
        include: {
            role: {
                include: {
                    permissions: {
                        include: {
                            permission: true,
                        },
                    },
                },
            },
        },
    });

    if (userOrgRoles.length === 0) {
        return {
            orgId: null,
            permissions: [],
        };
    }

    // Flatten permissions from all roles
    const permissionsSet = new Set<string>();
    userOrgRoles.forEach((uor) => {
        uor.role.permissions.forEach((rp) => {
            permissionsSet.add(rp.permission.name);
        });
    });

    return {
        orgId: userOrgRoles[0].organizationId,
        permissions: Array.from(permissionsSet),
    };
}
