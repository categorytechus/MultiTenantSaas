import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('Starting seed...')

    // 1. Create Permissions
    const permissions = [
        { name: '*', description: 'Full system access' },
        { name: 'org:read', description: 'View organization details' },
        { name: 'org:manage', description: 'Modify organization settings' },
        { name: 'users:read', description: 'View users in the organization' },
        { name: 'users:manage', description: 'Create, edit, or delete users within the organization' },
    ]

    for (const p of permissions) {
        await prisma.permission.upsert({
            where: { name: p.name },
            update: {},
            create: p,
        })
    }

    // 2. Create Roles and Link Permissions
    const roles = [
        {
            name: 'SUPER_ADMIN',
            description: 'Global administrator with access to everything',
            perms: ['*'],
        },
        {
            name: 'TENANT_ADMIN',
            description: 'Organization administrator with user management',
            perms: ['org:read', 'users:manage', 'users:read'],
        },
        {
            name: 'USER',
            description: 'Standard organization member with read access',
            perms: ['org:read', 'users:read'],
        },
    ]

    for (const r of roles) {
        const role = await prisma.role.upsert({
            where: { name: r.name },
            update: {},
            create: {
                name: r.name,
                description: r.description,
            },
        })

        // Link permissions to roles
        for (const permName of r.perms) {
            const perm = await prisma.permission.findUnique({ where: { name: permName } })
            if (perm) {
                await prisma.rolePermission.upsert({
                    where: {
                        roleId_permissionId: {
                            roleId: role.id,
                            permissionId: perm.id,
                        },
                    },
                    update: {},
                    create: {
                        roleId: role.id,
                        permissionId: perm.id,
                    },
                })
            }
        }
    }

    console.log('Seed completed successfully.')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
