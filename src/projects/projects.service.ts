import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from './project.entity';
import { ProjectMember } from './project-member.entity';
import { ProjectRole } from '../common/enums/project-role.enum';
import { MembershipCacheService } from '../authorization/membership-cache.service';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectsRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMembersRepository: Repository<ProjectMember>,
    // Challenge X3: invalidate RolesGuard's cache at the two points in
    // this service where a project's membership set actually changes.
    private readonly membershipCache: MembershipCacheService,
  ) {}

  async create(ownerId: string | undefined, name: string): Promise<Project> {
    const project = await this.projectsRepository.save(
      this.projectsRepository.create({ name, ownerId }),
    );

    // The creator is always seeded as the project's owner in
    // project_members - this is what every later permission check reads.
    await this.projectMembersRepository.save(
      this.projectMembersRepository.create({
        userId: ownerId,
        projectId: project.id,
        role: ProjectRole.OWNER,
      }),
    );

    // Defensive: guards against the unlikely case where a lookup for
    // this exact (user, project) pair happened to be cached (e.g. as a
    // miss) before this project existed.
    if (ownerId) {
      this.membershipCache.invalidate(ownerId, project.id);
    }

    return project;
  }

  async findByIdOrThrow(id: string): Promise<Project> {
    const project = await this.projectsRepository.findOne({ where: { id } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async update(id: string, name?: string): Promise<Project> {
    const project = await this.findByIdOrThrow(id);
    if (name !== undefined) {
      project.name = name;
    }
    return this.projectsRepository.save(project);
  }

  async remove(id: string): Promise<void> {
    await this.findByIdOrThrow(id);
    await this.projectsRepository.delete({ id });
    // The delete cascades every project_members row for this project -
    // every cached membership for it is now stale and must go with it.
    this.membershipCache.invalidateProject(id);
  }

  findMembership(userId: string, projectId: string): Promise<ProjectMember | null> {
    return this.projectMembersRepository.findOne({ where: { userId, projectId } });
  }
}
