# Contributing to MultiTenant SaaS Platform

## Development Team
- **Developer A** (Texas, USA)
- **Developer B** (India)
- **Project Manager**: Gokhul (EST)
- **Overlap Window**: 2 hours daily

## Git Workflow

### Branch Strategy

We use a **Git Flow** branching model:

#### Main Branches
- `main` - Production-ready code only
- `develop` - Integration branch for ongoing development

#### Supporting Branches
- `feature/<ticket-id>-<short-description>` - New features
- `bugfix/<ticket-id>-<short-description>` - Bug fixes
- `hotfix/<description>` - Emergency production fixes
- `release/<version>` - Release preparation

### Workflow Steps

1. **Start New Work**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/DAY1-docker-setup
   ```

2. **Make Changes**
   - Write code
   - Format with Prettier: `npm run format` or `prettier --write .`
   - Test locally
   - Commit frequently with clear messages

3. **Commit Guidelines**
   ```bash
   git add .
   git commit -m "feat: add Dockerfile for frontend service"
   ```
   
   **Commit Message Format:**
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code formatting
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Build/tooling changes

4. **Push and Create PR**
   ```bash
   git push origin feature/DAY1-docker-setup
   ```
   - Go to GitHub and create Pull Request
   - Target branch: `develop`
   - Assign reviewer: Dev A or Gokhul
   - Add description of changes

5. **Code Review**
   - Address review comments
   - Push additional commits to the same branch
   - Request re-review

6. **Merge**
   - Once approved, squash and merge to `develop`
   - Delete feature branch after merge

## Definition of Done (Daily)

Before marking your work complete, ensure:

- [ ] Code committed to feature branch
- [ ] Code formatted with Prettier
- [ ] Basic functionality tested locally
- [ ] PR created and assigned for review
- [ ] Critical bugs logged with workarounds if needed

## Code Quality Standards

### Formatting
- **JavaScript/TypeScript**: Use Prettier with project config
- **Python**: Use Black with line length 100
- **All files**: 2-space indentation (unless language-specific)

### Testing
- Test locally before pushing
- Add unit tests for new functions
- Integration tests for API endpoints
- E2E tests for critical user flows

### Documentation
- Add JSDoc/docstrings for functions
- Update README if adding new features
- Document API changes in OpenAPI spec

## Docker Repository Naming

All Docker images should follow this convention:
```
<ecr-registry>/multitenant-saas-<service-name>:<tag>
```

Example:
```
123456789012.dkr.ecr.us-east-1.amazonaws.com/multitenant-saas-frontend:dev-abc123
```

## Environment Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- Docker 24+
- AWS CLI configured
- Access to GitHub repository
- Access to AWS ECR

### Local Development
```bash
# Clone repository
git clone https://github.com/categorytechus/MultiTenantSaas.git
cd MultiTenantSaas

# Frontend setup
cd frontend
npm install
npm run dev

# Backend services (Python)
cd agents/counselor
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Communication

### Daily Sync
- 2-hour overlap window
- Update status in Slack/Discord
- Flag blockers immediately

### Code Review Expectations
- Reviews within 4 hours during overlap
- Constructive feedback
- Approve if no critical issues

### Issue Reporting
- Use GitHub Issues
- Tag with appropriate labels: `bug`, `enhancement`, `documentation`
- Assign to appropriate developer
- Reference issue number in commits: `fix: resolve auth bug (#123)`

## Security

- **Never commit secrets** (API keys, passwords, tokens)
- Use AWS Secrets Manager for sensitive data
- Environment variables for configuration
- Add `.env` to `.gitignore`

## Questions?

Contact Gokhul or discuss in the team channel.

---

Last updated: January 28, 2026
